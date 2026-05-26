/**
 * Junior Executor
 *
 * Bridges the Master Brain's `dispatch_plan` to the concrete junior
 * agents. For each (`junior_name`, intent) pair we:
 *
 *   1. Look up the junior's Zod schema + factory in the registry.
 *   2. Synthesize a valid input via `synthesizeJuniorInput` (Haiku).
 *   3. Call `agent.processInput(input)`.
 *   4. Record `{ junior_name, intent, input, output, evidence_ids,
 *      confidence, error? }` and CONTINUE with the rest of the plan
 *      even if this junior fails.
 *
 * Execution is sequential by default (safer for the early demo — we have
 * no Anthropic rate-limit handling yet). A `parallel: true` toggle is
 * exposed for callers who want fan-out.
 *
 * The executor surfaces lifecycle callbacks (`onStart`, `onResult`) so
 * the chat orchestrator can stream `junior_call` SSE events as each
 * junior begins and completes — the wire format itself lives in the
 * orchestrator (this module stays transport-agnostic).
 */

import { type ZodSchema } from 'zod';
import { synthesizeJuniorInput, type SynthesisContext } from './synthesizer.js';
import type { ClaudeClient, JuniorLogger } from './_shared.js';
import {
  JUNIOR_REGISTRY,
  NON_EXECUTABLE_JUNIORS,
  type JuniorEntry,
} from './executor-registry.js';

export { type JuniorEntry, type JuniorAgent } from './executor-registry.js';

// ─────────────────────────────────────────────────────────────────────
// Error class — surfaced when ANTHROPIC_API_KEY is missing
// ─────────────────────────────────────────────────────────────────────

export class BorjieConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BorjieConfigError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface JuniorExecutionResult {
  readonly junior_name: string;
  readonly intent: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly evidence_ids: ReadonlyArray<string>;
  readonly confidence: number;
  readonly error?: string;
  readonly skipped?: boolean;
}

export interface DispatchPlanStep {
  readonly junior: string;
  readonly intent: string;
}

export interface ExecutorContext {
  readonly tenantId: string;
  readonly chat_message: string;
  readonly mode: string;
  readonly lmbm_context?: Readonly<Record<string, unknown>>;
}

export interface ExecutorHooks {
  /** Invoked just before each junior is dispatched. */
  onStart?(step: DispatchPlanStep): void | Promise<void>;
  /** Invoked once a junior finishes (success, skip, or error). */
  onResult?(result: JuniorExecutionResult): void | Promise<void>;
}

export interface ExecuteJuniorsArgs {
  readonly dispatchPlan: ReadonlyArray<DispatchPlanStep>;
  readonly context: ExecutorContext;
  readonly claude: ClaudeClient;
  readonly parallel?: boolean;
  readonly hooks?: ExecutorHooks;
  readonly logger?: JuniorLogger;
  /**
   * Override the default junior registry. Primarily for tests — allows
   * injecting stub agents without touching the global factory map.
   */
  readonly registry?: Readonly<Record<string, JuniorEntry<ZodSchema>>>;
  /**
   * Skip the `ANTHROPIC_API_KEY` config check. Tests inject their own
   * claude stub, so the env-var gate doesn't apply.
   */
  readonly skipConfigCheck?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function pickEvidenceIds(output: unknown): ReadonlyArray<string> {
  if (output && typeof output === 'object' && 'evidence_ids' in output) {
    const ids = (output as { evidence_ids: unknown }).evidence_ids;
    if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

function pickConfidence(output: unknown): number {
  if (output && typeof output === 'object' && 'confidence' in output) {
    const c = (output as { confidence: unknown }).confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return 0;
}

function skippedResult(step: DispatchPlanStep): JuniorExecutionResult {
  return {
    junior_name: step.junior,
    intent: step.intent,
    input: null,
    output: null,
    evidence_ids: [],
    confidence: 0,
    skipped: true,
  };
}

function unknownJuniorResult(step: DispatchPlanStep): JuniorExecutionResult {
  return {
    junior_name: step.junior,
    intent: step.intent,
    input: null,
    output: null,
    evidence_ids: [],
    confidence: 0,
    error: `unknown_junior: ${step.junior}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-step executor
// ─────────────────────────────────────────────────────────────────────

async function executeOne(
  step: DispatchPlanStep,
  args: ExecuteJuniorsArgs,
): Promise<JuniorExecutionResult> {
  const { context, claude, logger, hooks } = args;
  const registry = args.registry ?? JUNIOR_REGISTRY;
  await hooks?.onStart?.(step);

  if (NON_EXECUTABLE_JUNIORS.has(step.junior)) {
    const skip = skippedResult(step);
    await hooks?.onResult?.(skip);
    return skip;
  }

  const reg = registry[step.junior];
  if (!reg) {
    logger?.warn('executor: unknown junior in dispatch plan', { junior: step.junior });
    const miss = unknownJuniorResult(step);
    await hooks?.onResult?.(miss);
    return miss;
  }

  const synthCtx: SynthesisContext = {
    junior_name: step.junior,
    chat_message: context.chat_message,
    mode: context.mode,
    tenantId: context.tenantId,
    lmbm_context: context.lmbm_context ?? {},
  };

  const synth = await synthesizeJuniorInput({
    claude,
    schema: reg.schema,
    context: synthCtx,
    logger,
  });

  if (synth.ok !== true) {
    const reason = (synth as { ok: false; reason: string }).reason;
    const fail: JuniorExecutionResult = {
      junior_name: step.junior,
      intent: step.intent,
      input: null,
      output: null,
      evidence_ids: [],
      confidence: 0,
      error: `synthesis_failed: ${reason}`,
    };
    await hooks?.onResult?.(fail);
    return fail;
  }

  try {
    const agent = reg.factory();
    const output = await agent.processInput(synth.input);
    const result: JuniorExecutionResult = {
      junior_name: step.junior,
      intent: step.intent,
      input: synth.input,
      output,
      evidence_ids: pickEvidenceIds(output),
      confidence: pickConfidence(output),
    };
    await hooks?.onResult?.(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn('executor: junior threw', { junior: step.junior, error: message });
    const fail: JuniorExecutionResult = {
      junior_name: step.junior,
      intent: step.intent,
      input: synth.input,
      output: null,
      evidence_ids: [],
      confidence: 0,
      error: `junior_failed: ${message}`,
    };
    await hooks?.onResult?.(fail);
    return fail;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Top-level executor
// ─────────────────────────────────────────────────────────────────────

/**
 * Execute every junior in the dispatch plan. Failures of individual
 * juniors NEVER abort the chain — they are surfaced via `result.error`
 * and execution continues with the next junior.
 */
export async function executeJuniors(
  args: ExecuteJuniorsArgs,
): Promise<ReadonlyArray<JuniorExecutionResult>> {
  if (!args.skipConfigCheck && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new BorjieConfigError(
      'ANTHROPIC_API_KEY missing — per-junior execution requires a real Claude client (no mock fallback).',
    );
  }

  if (args.parallel) {
    return Promise.all(args.dispatchPlan.map((step) => executeOne(step, args)));
  }

  const results: JuniorExecutionResult[] = [];
  for (const step of args.dispatchPlan) {
    // eslint-disable-next-line no-await-in-loop -- SCRUB-5f: rule-disabled because sequential dispatch is intentional; the parallel branch above handles concurrency and steps may depend on prior side-effects
    results.push(await executeOne(step, args));
  }
  return results;
}
