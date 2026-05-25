/**
 * Reflexion (Shinn et al. 2023) — execute → evaluate → self-critique
 * → retry with a learning prepended to the next attempt.
 *
 * 2026 best practice: cap loops at 3, escalate to a stronger model on
 * the second retry, and persist the learning so subsequent tasks
 * benefit (Voyager-style skill promotion).
 *
 * Pure orchestration. Caller supplies `runner` (any ExecutionResult-
 * producing function: ReAct, Plan-and-Execute, raw brain), an
 * `evaluator` that judges quality, and an optional `criticPrompt`
 * builder used to compose the next-attempt preamble.
 */

import type {
  Critique,
  ExecutionResult,
  ExecutionTraceEntry,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage } from '../types.js';
import { critiqueEntry, finalEntry, makeExecutionResult } from '../internal/trace.js';

export interface ReflexionRunner {
  /**
   * Run the underlying agent with an optional learning preamble that
   * was emitted by the critic on the prior pass.
   */
  run(task: Task, learning: string | null): Promise<ExecutionResult>;
}

export interface ReflexionEvaluator {
  evaluate(task: Task, result: ExecutionResult): Promise<{ critique: Critique; usage?: TokenUsage }>;
}

export interface RunReflexionInput {
  readonly task: Task;
  readonly runner: ReflexionRunner;
  readonly evaluator: ReflexionEvaluator;
  /** Max evaluate→retry loops (inclusive of the initial attempt). */
  readonly maxLoops?: number;
  /** Acceptance threshold for the critic confidence in [0,1]. */
  readonly acceptThreshold?: number;
  /**
   * Optional hook called whenever a critique is produced — useful for
   * persisting learnings to a long-term store (skill library).
   */
  readonly onLearning?: (learning: string) => void;
}

export const DEFAULT_REFLEXION_MAX_LOOPS = 3;
export const DEFAULT_REFLEXION_ACCEPT_THRESHOLD = 0.7;

export async function runReflexion(input: RunReflexionInput): Promise<ExecutionResult> {
  const maxLoops = input.maxLoops ?? DEFAULT_REFLEXION_MAX_LOOPS;
  const threshold = input.acceptThreshold ?? DEFAULT_REFLEXION_ACCEPT_THRESHOLD;

  if (maxLoops < 1) {
    throw new Error('maxLoops must be >= 1');
  }

  const trace: ExecutionTraceEntry[] = [];
  let usage: TokenUsage = emptyUsage();
  let brainCalls = 0;
  let lastResult: ExecutionResult | null = null;
  let lastLearning: string | null = null;

  for (let attempt = 0; attempt < maxLoops; attempt++) {
    const result = await input.runner.run(input.task, lastLearning);
    usage = addUsage(usage, result.usage);
    brainCalls += result.brainCalls;
    // Splice in the attempt's trace, prefixed for clarity.
    for (const entry of result.trace) {
      const newDetail = `[try ${attempt + 1}] ${entry.detail}`;
      if (entry.agentId !== undefined) {
        trace.push(Object.freeze({ at: entry.at, kind: entry.kind, detail: newDetail, agentId: entry.agentId }));
      } else {
        trace.push(Object.freeze({ at: entry.at, kind: entry.kind, detail: newDetail }));
      }
    }
    lastResult = result;

    if (result.outcome !== 'success' && result.outcome !== 'failed') {
      // Budget exhausted or hand-off: stop immediately.
      return finish(trace, result.answer, usage, brainCalls, result.outcome, result.reason);
    }

    const evalOut = await input.evaluator.evaluate(input.task, result);
    if (evalOut.usage) usage = addUsage(usage, evalOut.usage);
    brainCalls += 1;
    const c = evalOut.critique;
    trace.push(
      critiqueEntry(
        `accept=${c.accept} conf=${c.confidence.toFixed(2)} rationale=${c.rationale}`,
      ),
    );

    if (c.accept && c.confidence >= threshold && result.outcome === 'success') {
      trace.push(finalEntry(result.answer));
      return finish(trace, result.answer, usage, brainCalls, 'success');
    }

    // Compose a learning the next attempt will read.
    lastLearning = composeLearning(c, attempt);
    if (input.onLearning) input.onLearning(lastLearning);
  }

  // Exhausted loops — return last result with `failed` outcome.
  const final = lastResult ?? emptyExecutionResult();
  return finish(trace, final.answer, usage, brainCalls, 'failed', `reflexion exhausted after ${maxLoops} attempts`);
}

function composeLearning(critique: Critique, priorAttempt: number): string {
  const bullets = critique.suggestions.length > 0
    ? critique.suggestions.map((s) => `  - ${s}`).join('\n')
    : '  - (no specific suggestions provided)';
  return [
    `[learning from attempt ${priorAttempt + 1}]`,
    `Rationale: ${critique.rationale}`,
    'Improvements to apply next pass:',
    bullets,
  ].join('\n');
}

function emptyExecutionResult(): ExecutionResult {
  return makeExecutionResult({
    outcome: 'failed',
    answer: '',
    trace: [],
    usage: emptyUsage(),
    brainCalls: 0,
  });
}

function finish(
  trace: ReadonlyArray<ExecutionTraceEntry>,
  answer: string,
  usage: TokenUsage,
  brainCalls: number,
  outcome: ExecutionResult['outcome'],
  reason?: string,
): ExecutionResult {
  return reason !== undefined
    ? makeExecutionResult({ outcome, answer, trace, usage, brainCalls, reason })
    : makeExecutionResult({ outcome, answer, trace, usage, brainCalls });
}
