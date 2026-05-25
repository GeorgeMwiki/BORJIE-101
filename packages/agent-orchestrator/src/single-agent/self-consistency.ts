/**
 * Self-Consistency (Wang et al. 2022) — sample N independent reasoning
 * chains at temperature > 0, then take the majority answer.
 *
 * Beats greedy decoding on reasoning tasks (GSM8K +17%). 2026 best
 * practice pairs Self-Consistency with structured-output extraction so
 * "votes" are over canonicalised answers rather than raw text.
 */

import type {
  AgentSpec,
  BrainPort,
  ExecutionResult,
  ExecutionTraceEntry,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage } from '../types.js';
import { finalEntry, makeExecutionResult, thought, voteEntry } from '../internal/trace.js';

export interface RunSelfConsistencyInput {
  readonly agent: AgentSpec;
  readonly task: Task;
  readonly brain: BrainPort;
  /** Number of independent samples to draw (default 5). */
  readonly n?: number;
  /** Temperature for sampling diversity. */
  readonly temperature?: number;
  /**
   * Optional canonicaliser — normalises raw text answers before voting
   * (lower-case, strip whitespace, extract final number, etc.). Default
   * trims + lower-cases.
   */
  readonly canonicalise?: (text: string) => string;
}

export const DEFAULT_SELF_CONSISTENCY_N = 5;
export const DEFAULT_SELF_CONSISTENCY_TEMPERATURE = 0.7;

export async function runSelfConsistency(input: RunSelfConsistencyInput): Promise<ExecutionResult> {
  const n = input.n ?? DEFAULT_SELF_CONSISTENCY_N;
  const temperature = input.temperature ?? DEFAULT_SELF_CONSISTENCY_TEMPERATURE;
  if (n < 1) throw new Error('n must be >= 1');

  const canon = input.canonicalise ?? defaultCanonicalise;
  const trace: ExecutionTraceEntry[] = [];
  let usage: TokenUsage = emptyUsage();
  const samples: { raw: string; canonical: string }[] = [];

  for (let i = 0; i < n; i++) {
    const resp = await input.brain.call({
      system: input.agent.systemPrompt,
      messages: [{ role: 'user', content: input.task.description }],
      temperature,
      traceTag: `self-consistency:${input.agent.id}:sample-${i}`,
    });
    usage = addUsage(usage, resp.usage);
    if (resp.text) {
      trace.push(thought(`sample ${i + 1}: ${resp.text}`, input.agent.id));
    }
    samples.push({ raw: resp.text, canonical: canon(resp.text) });
  }

  // Tally votes by canonical key.
  const tally = new Map<string, number>();
  const exemplar = new Map<string, string>();
  for (const s of samples) {
    tally.set(s.canonical, (tally.get(s.canonical) ?? 0) + 1);
    if (!exemplar.has(s.canonical)) exemplar.set(s.canonical, s.raw);
  }

  // Pick the canonical with the most votes; tie-break on first-seen.
  let winner = '';
  let winnerCount = 0;
  let winnerOrder = Infinity;
  let order = 0;
  for (const [key, count] of tally) {
    const insertionOrder = order++;
    if (
      count > winnerCount ||
      (count === winnerCount && insertionOrder < winnerOrder)
    ) {
      winner = key;
      winnerCount = count;
      winnerOrder = insertionOrder;
    }
  }

  for (const [key, count] of tally) {
    trace.push(voteEntry(`'${key}' -> ${count}/${n}`, input.agent.id));
  }

  const answer = exemplar.get(winner) ?? '';
  trace.push(finalEntry(answer, input.agent.id));

  return makeExecutionResult({
    outcome: 'success',
    answer,
    trace,
    usage,
    brainCalls: n,
    reason: `majority ${winnerCount}/${n}`,
  });
}

function defaultCanonicalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
