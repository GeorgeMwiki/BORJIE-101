/**
 * Content-based recommender — cosine similarity over EmbeddingVectors.
 *
 * Strategy:
 *   1. Build a "user vector" by averaging the embeddings of items the
 *      user has interacted with positively (rating >= ratingThreshold).
 *      If the user has no interactions and `request.user.embedding` is
 *      present, use that instead.
 *   2. Score each candidate by cosine similarity to the user vector.
 *   3. Sort descending, tie-break by itemId.
 *
 * The function is tenant-strict: a candidate with a different
 * `tenantId` throws. Embeddings of differing dimensionality also
 * throw — there is no implicit padding.
 *
 * Citation: Pazzani & Billsus — "Content-Based Recommendation
 * Systems", The Adaptive Web, LNCS 4321, 2007 (canonical baseline;
 * re-issued in the Recommender Systems Handbook 3rd ed., 2024).
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
  Item,
} from '../types.js';
import { cosine } from '../util/linalg.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'content_based' as const;

export interface ContentBasedOptions {
  /** Minimum rating to count as a "positive" interaction. Default 0.5. */
  readonly ratingThreshold?: number;
  /** prevHash for chaining audit hashes. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

export function createContentBasedRecommender(
  opts: ContentBasedOptions = {},
): RecommendationPort {
  const ratingThreshold = opts.ratingThreshold ?? 0.5;
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const candidateIds = request.candidates.map((c) => c.id);
    const userVec = buildUserVector(request, ratingThreshold);
    let scored: ScoredItem[];
    if (userVec === null) {
      // No usable user vector — return zero scores. Cold-start router
      // should have routed to popularity, but if we're called direct,
      // return the candidates with score 0 deterministically.
      scored = request.candidates.map((c) => ({
        itemId: c.id,
        score: 0,
        reason: 'content_based: no user vector',
      }));
    } else {
      scored = request.candidates.map((c) => {
        if (!c.embedding) {
          return {
            itemId: c.id,
            score: 0,
            reason: 'content_based: no item embedding',
          };
        }
        if (c.embedding.values.length !== userVec.length) {
          throw new Error(
            `content_based: item ${c.id} embedding dim ${c.embedding.values.length} != user dim ${userVec.length}`,
          );
        }
        return {
          itemId: c.id,
          score: cosine(userVec, c.embedding.values),
          reason: 'content_based: cosine(user, item)',
        };
      });
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

function buildUserVector(
  request: RecommendationRequest,
  ratingThreshold: number,
): number[] | null {
  // First preference: average over positively-interacted items'
  // embeddings present in candidates (so dimensionality is consistent).
  const itemById = new Map<string, Item>();
  for (const item of request.candidates) itemById.set(item.id, item);
  let sum: number[] | null = null;
  let count = 0;
  for (const ix of request.interactions) {
    if (ix.tenantId !== request.tenantId) continue;
    if (ix.userId !== request.userId) continue;
    if (ix.rating < ratingThreshold) continue;
    const item = itemById.get(ix.itemId);
    if (!item || !item.embedding) continue;
    if (sum === null) {
      sum = [...item.embedding.values];
    } else {
      if (sum.length !== item.embedding.values.length) continue;
      for (let i = 0; i < sum.length; i += 1)
        sum[i] = (sum[i] as number) + (item.embedding.values[i] as number);
    }
    count += 1;
  }
  if (sum !== null && count > 0) {
    return sum.map((v) => v / count);
  }
  // Fallback: caller-supplied user embedding.
  if (request.user?.embedding) {
    return [...request.user.embedding.values];
  }
  return null;
}

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `content_based: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
    if (item.embedding && item.embedding.tenantId !== request.tenantId) {
      throw new Error(
        `content_based: candidate ${item.id} embedding tenant ${item.embedding.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
  if (
    request.user?.embedding &&
    request.user.embedding.tenantId !== request.tenantId
  ) {
    throw new Error(
      `content_based: user embedding tenant ${request.user.embedding.tenantId} != request tenant ${request.tenantId}`,
    );
  }
}
