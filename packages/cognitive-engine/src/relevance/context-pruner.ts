/**
 * Context pruner — Discipline 5, stage 2.
 *
 * Greedy knapsack: keeps the highest-scoring items that fit within the
 * caller-supplied token budget. Returns the kept items + a summary of
 * what was dropped (for the audit trail).
 *
 * @module @borjie/cognitive-engine/relevance/context-pruner
 */

import type { ScoredContextItem } from './relevance-scorer.js';

export interface PruneResult {
  readonly kept: ReadonlyArray<ScoredContextItem>;
  readonly dropped: ReadonlyArray<ScoredContextItem>;
  readonly tokens_used: number;
  readonly tokens_dropped: number;
}

/** Default token budget for the per-turn context window allocation. */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 6000;

/** Floor — items below this score are never included, even if cheap. */
export const MIN_RELEVANCE_FLOOR = 0.05;

export function pruneContext(
  scored: ReadonlyArray<ScoredContextItem>,
  tokenBudget: number = DEFAULT_CONTEXT_BUDGET_TOKENS,
  floor: number = MIN_RELEVANCE_FLOOR,
): PruneResult {
  const eligible = scored
    .filter((s) => s.score >= floor)
    .slice()
    .sort((a, b) => b.score - a.score);

  const kept: Array<ScoredContextItem> = [];
  let used = 0;
  for (const item of eligible) {
    if (used + item.token_cost <= tokenBudget) {
      kept.push(item);
      used += item.token_cost;
    }
  }
  const keptIds = new Set(kept.map((k) => k.ref_id));
  const dropped = scored.filter((s) => !keptIds.has(s.ref_id));
  const droppedTokens = dropped.reduce((acc, d) => acc + d.token_cost, 0);
  return {
    kept,
    dropped,
    tokens_used: used,
    tokens_dropped: droppedTokens,
  };
}
