/**
 * Maximal Marginal Relevance (MMR) reranker.
 *
 *   MMR(c) = λ · relevance(c) − (1 − λ) · max_{s ∈ S} similarity(c, s)
 *
 * Greedy: repeatedly pick the candidate with the highest MMR score
 * against the already-selected set. The similarity function defaults
 * to cosine on `EmbeddingVector` but is injectable so callers can
 * supply a feature-grounded one (e.g., jurisdiction match for
 * regulator↔filing).
 *
 * Citation: Carbonell & Goldstein — "The Use of MMR, Diversity-Based
 * Reranking for Reordering Documents and Producing Summaries", SIGIR
 * 1998. The canonical diversity reranker referenced in 2024-2026
 * IR/recsys diversity literature.
 */

import type { Item, ScoredItem } from '../types.js';
import { cosine } from '../util/linalg.js';

export interface MMROptions {
  /** Lambda in [0, 1]. 1.0 = pure relevance, 0.0 = pure diversity. */
  readonly lambda: number;
  /** Similarity over candidate items. Default cosine over
   *  `item.embedding.values`. Items without an embedding score 0. */
  readonly similarity?: (a: Item, b: Item) => number;
  /** Max output size. */
  readonly topK: number;
}

export function rerankMMR(
  scored: ReadonlyArray<ScoredItem>,
  items: ReadonlyArray<Item>,
  opts: MMROptions,
): ScoredItem[] {
  if (opts.lambda < 0 || opts.lambda > 1) {
    throw new Error(`mmr: lambda must be in [0,1], got ${opts.lambda}`);
  }
  const lambda = opts.lambda;
  const sim = opts.similarity ?? defaultSimilarity;
  const byId = new Map<string, Item>();
  for (const item of items) byId.set(item.id, item);
  const pool = [...scored];
  const selected: ScoredItem[] = [];
  const selectedItems: Item[] = [];
  while (selected.length < opts.topK && pool.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i] as ScoredItem;
      const itemA = byId.get(candidate.itemId);
      if (!itemA) continue;
      let maxSim = 0;
      for (const s of selectedItems) {
        const v = sim(itemA, s);
        if (v > maxSim) maxSim = v;
      }
      const mmr = lambda * candidate.score - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const winner = pool.splice(bestIdx, 1)[0] as ScoredItem;
    const winnerItem = byId.get(winner.itemId);
    if (winnerItem) selectedItems.push(winnerItem);
    selected.push({
      itemId: winner.itemId,
      score: winner.score,
      reason: `mmr(λ=${lambda}): ${winner.reason ?? ''}`.trim(),
    });
  }
  return selected;
}

function defaultSimilarity(a: Item, b: Item): number {
  if (!a.embedding || !b.embedding) return 0;
  if (a.embedding.values.length !== b.embedding.values.length) return 0;
  return cosine(a.embedding.values, b.embedding.values);
}
