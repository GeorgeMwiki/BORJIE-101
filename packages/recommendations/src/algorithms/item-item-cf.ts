/**
 * Item-Item Collaborative Filtering — pure TypeScript.
 *
 * Steps:
 *   1. Build an item × user rating matrix from the tenant-scoped
 *      interactions.
 *   2. For each candidate item, compute Pearson similarity to every
 *      item the target user has rated; require `minOverlap` co-rating
 *      users.
 *   3. Predict the target user's rating for the candidate as a
 *      similarity-weighted average of their ratings on the most
 *      similar items.
 *   4. Sort by predicted rating, tie-break on itemId.
 *
 * Why item-item over user-user: items change slower than users, so
 * the item-similarity matrix is more stable under streaming
 * interactions — and the prediction step is O(rated × K) per
 * candidate, easy to bound on the hot path.
 *
 * Citation: Sarwar, Karypis, Konstan, Riedl — "Item-Based
 * Collaborative Filtering Recommendation Algorithms", WWW 2001
 * (canonical item-item CF; re-issued in the Recommender Systems
 * Handbook 3rd ed., 2024 — section 4.2).
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
} from '../types.js';
import { pearson } from '../util/linalg.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'item_item_cf' as const;

export interface ItemItemCFOptions {
  /** Minimum co-rating users needed before similarity counts. Default 2. */
  readonly minOverlap?: number;
  /** Top-K similar items to consider per candidate. Default 25. */
  readonly neighbours?: number;
  /** When true, demote items the target user has already rated to the
   *  bottom of the ranking. Canonical recommendation semantics:
   *  predict what the user has NOT seen. Default true. */
  readonly excludeRatedItems?: boolean;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

interface ItemProfile {
  readonly itemId: string;
  readonly ratings: Map<string, number>;
  readonly mean: number;
}

export function createItemItemCFRecommender(
  opts: ItemItemCFOptions = {},
): RecommendationPort {
  const minOverlap = opts.minOverlap ?? 2;
  const k = opts.neighbours ?? 25;
  const excludeRated = opts.excludeRatedItems ?? true;
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const itemProfiles = buildItemProfiles(request);
    const targetRatings = new Map<string, number>();
    for (const ix of request.interactions) {
      if (ix.tenantId !== request.tenantId) continue;
      if (ix.userId !== request.userId) continue;
      targetRatings.set(ix.itemId, ix.rating);
    }
    const candidateIds = request.candidates.map((c) => c.id);
    let scored: ScoredItem[];
    if (targetRatings.size === 0) {
      scored = candidateIds.map((id) => ({
        itemId: id,
        score: 0,
        reason: 'item_item_cf: target has no ratings',
      }));
    } else {
      scored = candidateIds.map((cid) => {
        const cp = itemProfiles.get(cid);
        const sims: Array<{
          itemId: string;
          similarity: number;
          rating: number;
        }> = [];
        for (const [ratedId, rating] of targetRatings) {
          const rp = itemProfiles.get(ratedId);
          if (!rp || !cp) continue;
          const overlap = collectOverlap(cp, rp);
          if (overlap.a.length < minOverlap) continue;
          const sim = pearson(overlap.a, overlap.b);
          if (sim <= 0) continue;
          sims.push({ itemId: ratedId, similarity: sim, rating });
        }
        sims.sort((a, b) => b.similarity - a.similarity);
        const top = sims.slice(0, k);
        if (top.length === 0) {
          return {
            itemId: cid,
            score: 0,
            reason: 'item_item_cf: no similar items',
          };
        }
        let num = 0;
        let den = 0;
        for (const s of top) {
          num += s.similarity * s.rating;
          den += s.similarity;
        }
        return {
          itemId: cid,
          score: num / den,
          reason: `item_item_cf: ${top.length} neighbours`,
        };
      });
      if (excludeRated) {
        scored = scored.map((s) =>
          targetRatings.has(s.itemId)
            ? {
                itemId: s.itemId,
                score: -Infinity,
                reason: 'item_item_cf: already rated by target',
              }
            : s,
        );
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
    });
    const topK = scored.slice(0, Math.max(0, request.topK));
    return sealResult({
      tenantId: request.tenantId,
      target: request.target,
      algorithm: ALGORITHM,
      userId: request.userId,
      topK,
      candidates: candidateIds,
      servedAt: now(),
      prevHash,
    });
  }

  return { algorithm: ALGORITHM, recommend };
}

function buildItemProfiles(
  request: RecommendationRequest,
): Map<string, ItemProfile> {
  const byItem = new Map<string, Map<string, number>>();
  for (const ix of request.interactions) {
    if (ix.tenantId !== request.tenantId) continue;
    let row = byItem.get(ix.itemId);
    if (!row) {
      row = new Map<string, number>();
      byItem.set(ix.itemId, row);
    }
    row.set(ix.userId, ix.rating);
  }
  const out = new Map<string, ItemProfile>();
  for (const [itemId, ratings] of byItem) {
    let sum = 0;
    for (const v of ratings.values()) sum += v;
    const mean = ratings.size === 0 ? 0 : sum / ratings.size;
    out.set(itemId, { itemId, ratings, mean });
  }
  return out;
}

function collectOverlap(
  a: ItemProfile,
  b: ItemProfile,
): { a: number[]; b: number[] } {
  const out: { a: number[]; b: number[] } = { a: [], b: [] };
  for (const [userId, ratingA] of a.ratings) {
    const ratingB = b.ratings.get(userId);
    if (ratingB === undefined) continue;
    out.a.push(ratingA);
    out.b.push(ratingB);
  }
  return out;
}

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `item_item_cf: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
}
