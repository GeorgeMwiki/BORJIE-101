/**
 * history-summarize — fit a conversation history into a token budget by
 * collapsing the oldest turns into a single summary line.
 *
 * Strategy (recency-biased, the standard chat-window approach):
 *   1. Always keep the most-recent `keepRecent` turns verbatim.
 *   2. If the kept turns already fit `maxHistoryTokens`, return unchanged.
 *   3. Otherwise, summarise the *overflow* (everything older than the kept
 *      window) into one synthetic `summary` turn via an injected summariser.
 *
 * The summariser is a port — the default is a pure, dependency-free heuristic
 * that concatenates + truncates (so the helper is usable with zero wiring). A
 * composition root can inject an LLM-backed summariser for higher fidelity.
 *
 * Pure orchestration + never-throws: a throwing/failed summariser falls back to
 * the heuristic so history-fitting can never break the turn.
 */

import { estimateTokens } from './estimate-tokens.js';

export interface HistoryTurn {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

/** Async summariser port. Returns a single condensed string for the span. */
export type HistorySummariser = (turns: readonly HistoryTurn[]) => Promise<string>;

export interface SummarizeOptions {
  /** Hard token ceiling for the whole returned history. */
  readonly maxHistoryTokens: number;
  /** How many of the most-recent turns to keep verbatim. Default 6. */
  readonly keepRecent?: number;
  /** Role to stamp on the synthetic summary turn. Default 'system'. */
  readonly summaryRole?: HistoryTurn['role'];
  /** Optional LLM-backed summariser; falls back to the heuristic on failure. */
  readonly summarise?: HistorySummariser;
}

export interface SummarizeResult {
  /** The fitted history: [summary?, ...recent]. */
  readonly turns: readonly HistoryTurn[];
  /** True if any older turns were collapsed into a summary. */
  readonly summarized: boolean;
  /** Count of original turns folded into the summary. */
  readonly collapsedCount: number;
  /** Estimated tokens of the returned history. */
  readonly tokens: number;
}

const DEFAULT_KEEP_RECENT = 6;
const SUMMARY_CHAR_BUDGET = 1_200;

/** Pure heuristic summariser: label + truncate. No I/O. */
function heuristicSummary(turns: readonly HistoryTurn[]): string {
  const joined = turns.map((t) => `${t.role}: ${t.content}`).join('\n');
  const clipped = joined.length > SUMMARY_CHAR_BUDGET ? `${joined.slice(0, SUMMARY_CHAR_BUDGET)}…` : joined;
  return `[Earlier conversation summary — ${turns.length} turn(s)]\n${clipped}`;
}

function sumTokens(turns: readonly HistoryTurn[]): number {
  let total = 0;
  for (const t of turns) total += estimateTokens(t.content);
  return total;
}

/**
 * Collapse overflow history into a summary so the whole thing fits
 * `maxHistoryTokens`. Recency-biased; never throws.
 */
export async function summarizeOverflowHistory(
  history: readonly HistoryTurn[],
  opts: SummarizeOptions,
): Promise<SummarizeResult> {
  const keepRecent = Math.max(0, opts.keepRecent ?? DEFAULT_KEEP_RECENT);
  const summaryRole = opts.summaryRole ?? 'system';

  // Nothing to fold: short history, or it already fits.
  if (history.length <= keepRecent || sumTokens(history) <= opts.maxHistoryTokens) {
    return {
      turns: history,
      summarized: false,
      collapsedCount: 0,
      tokens: sumTokens(history),
    };
  }

  const splitAt = history.length - keepRecent;
  const overflow = history.slice(0, splitAt);
  const recent = history.slice(splitAt);

  let summaryText: string;
  if (opts.summarise) {
    try {
      const out = await opts.summarise(overflow);
      summaryText = out && out.trim().length > 0 ? out : heuristicSummary(overflow);
    } catch {
      // Injected summariser failed — fall back to the pure heuristic.
      summaryText = heuristicSummary(overflow);
    }
  } else {
    summaryText = heuristicSummary(overflow);
  }

  const summaryTurn: HistoryTurn = { role: summaryRole, content: summaryText };
  const turns: readonly HistoryTurn[] = [summaryTurn, ...recent];

  return {
    turns,
    summarized: true,
    collapsedCount: overflow.length,
    tokens: sumTokens(turns),
  };
}
