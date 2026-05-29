/**
 * Plan Runner — CE-2 multi-turn orchestrator.
 *
 * Walks a `PlanDag` step-by-step, pausing at every `humanCheckpoint`
 * for confirmation. Each step's tool is dispatched via the supplied
 * `dispatchTool` callback — the runner has no direct dependency on
 * the brain-tool catalog (keeps testability + avoids the chicken-and-
 * egg with the composition root).
 *
 * Frontier references:
 *   - Manus AI Agent Mode's continuous-execute loop with evaluate-
 *     and-refine semantics.
 *   - ChatGPT Agent's sensitivity-tiered hand-back model.
 *
 * Discipline:
 *   - Immutable state (`coding-style.md`). Each step transition
 *     returns a NEW `PlanRunSnapshot`.
 *   - Functions <50 lines. Nesting <4.
 *   - Errors return failed snapshots — never throw across the
 *     runner boundary except for programming errors (bad plan).
 *   - The runner is pure-logic; persistence + audit happens at the
 *     callers (each step's tool already audits via the brain-tool
 *     adapter).
 */

import {
  topologicalOrder,
  validatePlanEdges,
  type PlanDag,
  type PlanRunSnapshot,
  type PlanStep,
  type PlanStepState,
} from './plan-dag';

export interface DispatchToolArgs {
  readonly toolId: string;
  readonly input: unknown;
  readonly stepId: string;
}

export interface DispatchToolResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

export type DispatchToolFn = (
  args: DispatchToolArgs,
) => Promise<DispatchToolResult>;

export interface ConfirmCheckpointArgs {
  readonly step: PlanStep;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

export interface ConfirmCheckpointResult {
  readonly confirmed: boolean;
  readonly reason?: string;
}

export type ConfirmCheckpointFn = (
  args: ConfirmCheckpointArgs,
) => Promise<ConfirmCheckpointResult>;

export interface RunPlanOptions {
  /** Dispatcher that runs a single tool. Required. */
  readonly dispatchTool: DispatchToolFn;
  /**
   * Confirmation hook — invoked exactly once per step whose
   * `humanCheckpoint` is non-empty. Required when ANY step has a
   * checkpoint; can be omitted for fully-autonomous low-stakes plans.
   */
  readonly confirmCheckpoint?: ConfirmCheckpointFn;
  /**
   * Stop the run on first failure. Defaults to true.
   * Set false to attempt every step that has no failing dependency.
   */
  readonly stopOnFailure?: boolean;
}

/**
 * Execute a plan. Returns the final snapshot.
 *
 * Steps run sequentially in topological order. Future revision can
 * fork independent branches in parallel (`Promise.all` over leaves
 * with no shared dependents); for v1 we keep sequential to make
 * the user-visible progress chip simpler to render.
 */
export async function runPlan(
  plan: PlanDag,
  options: RunPlanOptions,
): Promise<PlanRunSnapshot> {
  const problems = validatePlanEdges(plan);
  if (problems.length > 0) {
    throw new Error(`runPlan: invalid plan: ${problems.join('; ')}`);
  }
  const ordered = topologicalOrder(plan);
  const stopOnFailure = options.stopOnFailure ?? true;
  const states = new Map<string, PlanStepState>();
  const results = new Map<string, unknown>();
  const errors = new Map<string, string>();
  for (const step of ordered) states.set(step.id, 'pending');

  for (let i = 0; i < ordered.length; i += 1) {
    const step = ordered[i]!;
    if (anyDepFailed(plan, step.id, states)) {
      states.set(step.id, 'skipped');
      continue;
    }
    if (step.humanCheckpoint !== undefined) {
      const cp = await invokeConfirm(options, step, i, ordered.length);
      if (!cp.confirmed) {
        states.set(step.id, 'cancelled');
        errors.set(step.id, cp.reason ?? 'cancelled at checkpoint');
        if (stopOnFailure) break;
        continue;
      }
    }
    states.set(step.id, 'running');
    const res = await safeDispatch(options.dispatchTool, step);
    if (res.ok) {
      states.set(step.id, 'succeeded');
      if (res.value !== undefined) results.set(step.id, res.value);
    } else {
      states.set(step.id, 'failed');
      errors.set(step.id, res.error ?? 'unknown error');
      if (stopOnFailure) break;
    }
  }

  return buildSnapshot(plan, ordered, states, results, errors);
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function anyDepFailed(
  plan: PlanDag,
  stepId: string,
  states: Map<string, PlanStepState>,
): boolean {
  for (const edge of plan.edges) {
    if (edge.to !== stepId) continue;
    const s = states.get(edge.from);
    if (s === 'failed' || s === 'cancelled' || s === 'skipped') return true;
  }
  return false;
}

async function invokeConfirm(
  options: RunPlanOptions,
  step: PlanStep,
  i: number,
  total: number,
): Promise<ConfirmCheckpointResult> {
  if (!options.confirmCheckpoint) {
    return Object.freeze({
      confirmed: false,
      reason: `step ${step.id} requires confirmation but no hook supplied`,
    });
  }
  try {
    return await options.confirmCheckpoint({
      step,
      stepIndex: i,
      totalSteps: total,
    });
  } catch (error) {
    return Object.freeze({
      confirmed: false,
      reason: `confirmation hook threw: ${formatError(error)}`,
    });
  }
}

async function safeDispatch(
  dispatch: DispatchToolFn,
  step: PlanStep,
): Promise<DispatchToolResult> {
  try {
    return await dispatch({
      toolId: step.toolId,
      input: step.input,
      stepId: step.id,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      error: `dispatch threw: ${formatError(error)}`,
    });
  }
}

function buildSnapshot(
  plan: PlanDag,
  ordered: ReadonlyArray<PlanStep>,
  states: Map<string, PlanStepState>,
  results: Map<string, unknown>,
  errors: Map<string, string>,
): PlanRunSnapshot {
  const steps = ordered.map((s) => {
    const state = states.get(s.id) ?? 'pending';
    // exactOptionalPropertyTypes: optional fields must NOT be assigned
    // `undefined` literally — only set them when there's a real value.
    const entry: {
      id: string;
      state: PlanStepState;
      result?: unknown;
      error?: string;
    } = { id: s.id, state };
    if (results.has(s.id)) entry.result = results.get(s.id);
    if (errors.has(s.id)) {
      const err = errors.get(s.id);
      if (err !== undefined) entry.error = err;
    }
    return Object.freeze(entry);
  });
  const status = computeStatus(steps);
  return Object.freeze({ planId: plan.planId, steps, status });
}

function computeStatus(
  steps: ReadonlyArray<{ readonly state: PlanStepState }>,
): PlanRunSnapshot['status'] {
  const states = steps.map((s) => s.state);
  if (states.some((s) => s === 'running')) return 'running';
  if (states.some((s) => s === 'failed')) return 'failed';
  if (states.some((s) => s === 'cancelled')) return 'cancelled';
  if (states.every((s) => s === 'succeeded' || s === 'skipped')) {
    return 'succeeded';
  }
  if (states.every((s) => s === 'pending')) return 'idle';
  return 'paused';
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
