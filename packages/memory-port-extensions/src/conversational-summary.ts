/**
 * Conversational-summary memory layer.
 *
 * LITFIN ref: src/core/memory/{semantic-store,episodic-store}.ts —
 * compresses long agent transcripts into rolling summaries when token
 * budget is exceeded. We extract the prompt scaffolding and budget
 * arithmetic; the summarizer itself is an injected port.
 */

import type { MemoryClock } from './types.js';
import { DEFAULT_CLOCK } from './types.js';

export interface ChatTurn {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly tokens: number;
  readonly tsMs: number;
}

export interface SummarizerPort {
  readonly summarize: (turns: readonly ChatTurn[]) => Promise<{
    readonly summary: string;
    readonly tokens: number;
  }>;
}

export interface ConversationalSummaryConfig {
  /** Maximum token budget for the live tail (excludes summary). */
  readonly tailBudgetTokens: number;
  /** Minimum tokens we will leave in the tail to preserve recency. */
  readonly minTailTokens: number;
  /** Triggers compression when accumulated tokens exceed this. */
  readonly compressionTriggerTokens: number;
}

export interface ConversationalSummaryState {
  readonly summary: string;
  readonly summaryTokens: number;
  readonly tail: readonly ChatTurn[];
}

export const emptySummaryState = (): ConversationalSummaryState => ({
  summary: '',
  summaryTokens: 0,
  tail: [],
});

export const appendTurn = (
  state: ConversationalSummaryState,
  turn: ChatTurn,
): ConversationalSummaryState => ({
  summary: state.summary,
  summaryTokens: state.summaryTokens,
  tail: [...state.tail, turn],
});

const tailTokens = (tail: readonly ChatTurn[]): number =>
  tail.reduce((sum, t) => sum + t.tokens, 0);

export const needsCompression = (
  state: ConversationalSummaryState,
  cfg: ConversationalSummaryConfig,
): boolean => state.summaryTokens + tailTokens(state.tail) > cfg.compressionTriggerTokens;

/**
 * Splits the tail into (turns-to-summarize, turns-to-keep-live).
 * Always keeps at least `minTailTokens` worth of the latest turns.
 * Pure — does not call the summarizer.
 */
export const planCompression = (
  tail: readonly ChatTurn[],
  minTailTokens: number,
): {
  readonly toSummarize: readonly ChatTurn[];
  readonly keepLive: readonly ChatTurn[];
} => {
  let liveTokens = 0;
  let splitIdx = tail.length;
  for (let i = tail.length - 1; i >= 0; i--) {
    const turn = tail[i];
    if (turn === undefined) continue;
    if (liveTokens + turn.tokens > minTailTokens && splitIdx !== tail.length) {
      break;
    }
    liveTokens += turn.tokens;
    splitIdx = i;
  }
  return {
    toSummarize: tail.slice(0, splitIdx),
    keepLive: tail.slice(splitIdx),
  };
};

/**
 * Performs one compression cycle. Returns a new state with the
 * older turns folded into `summary` and the latest tail preserved.
 *
 * If the new summary itself would exceed the tail budget, the caller
 * should escalate (e.g. archive to long-term store) — we surface the
 * `summaryFitsBudget` flag so the wiring layer can react.
 */
export const compressOnce = async (
  state: ConversationalSummaryState,
  cfg: ConversationalSummaryConfig,
  summarizer: SummarizerPort,
  _clock: MemoryClock = DEFAULT_CLOCK,
): Promise<{
  readonly state: ConversationalSummaryState;
  readonly summaryFitsBudget: boolean;
}> => {
  if (!needsCompression(state, cfg)) {
    return { state, summaryFitsBudget: true };
  }
  const { toSummarize, keepLive } = planCompression(state.tail, cfg.minTailTokens);
  if (toSummarize.length === 0) {
    return { state, summaryFitsBudget: true };
  }
  // Re-summarize prior summary + new chunk together so we get one
  // monotonically-improving rolling summary, not a chain of stubs.
  const seed: ChatTurn = {
    role: 'system',
    content: `Prior summary: ${state.summary}`,
    tokens: state.summaryTokens,
    tsMs: toSummarize[0]?.tsMs ?? 0,
  };
  const folded = state.summary === '' ? toSummarize : [seed, ...toSummarize];
  const result = await summarizer.summarize(folded);
  return {
    state: {
      summary: result.summary,
      summaryTokens: result.tokens,
      tail: keepLive,
    },
    summaryFitsBudget: result.tokens <= cfg.tailBudgetTokens,
  };
};
