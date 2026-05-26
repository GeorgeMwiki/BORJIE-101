/**
 * Step runner — executes a single ResearchStep via a ToolAdapter.
 *
 * Per DEEP_RESEARCH_SPEC §4.2 (Executor), each step:
 *   1. Reserves estimated cost on the budget gate.
 *   2. Invokes the tool adapter (web_search, commodity_price, …).
 *   3. Captures the returned ResearchArtifact[].
 *   4. Commits the actual cost, scoring quality through the artifact's
 *      own `quality_score` field (which the adapter MUST set via the
 *      shared scorer — DEEP_RESEARCH_SPEC §4.3).
 *   5. Returns a typed StepRunResult with the artifact IDs + duration +
 *      cost; the runner never mutates the input step.
 *
 * Adapters are wired by the orchestrator's composition root via a
 * `ToolRegistry` map. A missing adapter is a hard skip (returns empty
 * artifacts) rather than a throw, mirroring the "missing env key →
 * tool is a no-op" pattern in research-tools.
 *
 * Pure async function. No DB I/O — the plan-runner persists.
 *
 * @module research-orchestrator/executor/step-runner
 */

import type {
  ResearchArtifact,
  ResearchStep,
  ResearchTool,
  ToolAdapter,
  ToolContext,
} from '../types.js';
import type { BudgetGate } from '../budgets/budget-gate.js';

export interface StepRunResult {
  readonly step_id: string;
  readonly status: 'done' | 'failed' | 'skipped';
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
  readonly error?: string;
}

/**
 * Adapter registry — the executor looks up an adapter by tool name.
 * Composition root wires the real adapters from
 * `@borjie/research-tools/adapters/*`. Missing keys return undefined,
 * which the runner treats as a skip.
 */
export type ToolRegistry = ReadonlyMap<
  ResearchTool,
  ToolAdapter<Readonly<Record<string, unknown>>, ReadonlyArray<ResearchArtifact>>
>;

export interface RunStepOptions {
  readonly step: ResearchStep;
  readonly registry: ToolRegistry;
  readonly toolContext: ToolContext;
  readonly budgetGate: BudgetGate;
  /** Override the wall-clock for tests. */
  readonly now?: () => number;
}

/**
 * Run one step. Never throws on a recoverable adapter outage — emits a
 * `status: 'failed'` result with the error message so the plan-runner
 * can record it.
 */
export async function runStep(options: RunStepOptions): Promise<StepRunResult> {
  const now = options.now ?? Date.now;
  const t0 = now();
  const adapter = options.registry.get(options.step.tool);

  // No adapter wired — skip cleanly.
  if (!adapter) {
    return {
      step_id: options.step.id,
      status: 'skipped',
      artifacts: Object.freeze([]) as ReadonlyArray<ResearchArtifact>,
      cost_usd_cents: 0,
      duration_ms: 0,
      error: `no_adapter_for_${options.step.tool}`,
    };
  }

  // Budget gate — reserve before the network call.
  const estimatedCents = adapter.cost_per_call_usd_cents;
  const currentSpend = await options.budgetGate.tracker.spent();
  const allowed = await options.budgetGate.canSpend(estimatedCents, currentSpend);
  if (!allowed) {
    return {
      step_id: options.step.id,
      status: 'skipped',
      artifacts: Object.freeze([]) as ReadonlyArray<ResearchArtifact>,
      cost_usd_cents: 0,
      duration_ms: now() - t0,
      error: 'budget_or_gate_blocked',
    };
  }

  // Invoke the adapter — try/catch so a thrown adapter doesn't crash
  // the plan; we still commit zero and release the reservation.
  let artifacts: ReadonlyArray<ResearchArtifact>;
  try {
    artifacts = await adapter.invoke(options.step.tool_input, options.toolContext);
  } catch (error) {
    await options.budgetGate.tracker.release(estimatedCents);
    return {
      step_id: options.step.id,
      status: 'failed',
      artifacts: Object.freeze([]) as ReadonlyArray<ResearchArtifact>,
      cost_usd_cents: 0,
      duration_ms: now() - t0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Aggregate actual cost from artifacts — adapters stamp per-artifact
  // cost in `cost_usd_cents`. Fall back to the reservation amount when
  // none was reported (adapter may sum into a single artifact).
  const actualCents = artifacts.length === 0
    ? 0
    : sumCost(artifacts) || estimatedCents;
  await options.budgetGate.tracker.commit(actualCents);

  return {
    step_id: options.step.id,
    status: 'done',
    artifacts,
    cost_usd_cents: actualCents,
    duration_ms: now() - t0,
  };
}

function sumCost(artifacts: ReadonlyArray<ResearchArtifact>): number {
  let total = 0;
  for (const a of artifacts) total += a.cost_usd_cents;
  return total;
}
