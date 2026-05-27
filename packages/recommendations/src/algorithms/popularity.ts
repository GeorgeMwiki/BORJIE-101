/**
 * Popularity baseline — the cold-start floor.
 *
 * Counts the number of interactions per candidate item in the
 * request's tenant-scoped `interactions` array. Returns the top-K
 * by interaction count, with deterministic tie-break on `itemId`
 * (lexicographic ascending). The score returned is the raw count,
 * not a probability — callers that need a probability should
 * normalise downstream.
 *
 * Per the SOTA-RECO spec, this is the floor model the cold-start
 * router falls back to when the per-user interaction count is below
 * the content-based threshold. It is the safest baseline because it
 * cannot leak across tenant boundaries (the caller's interactions
 * array IS the popularity table — there is no global popularity row).
 *
 * Citation: Schein, Popescul, Ungar, Pennock — "Methods and Metrics
 * for Cold-Start Recommendations", SIGIR 2002 (re-issued in the
 * Recommender Systems Handbook 3rd ed., 2024).
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
} from '../types.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'popularity' as const;

export interface PopularityOptions {
  /** prevHash for chaining audit hashes. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override for deterministic tests. Default Date.now. */
  readonly now?: () => number;
}

export function createPopularityRecommender(
  opts: PopularityOptions = {},
): RecommendationPort {
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const counts = new Map<string, number>();
    for (const ix of request.interactions) {
      if (ix.tenantId !== request.tenantId) continue;
      counts.set(ix.itemId, (counts.get(ix.itemId) ?? 0) + 1);
    }
    const candidateIds = request.candidates.map((c) => c.id);
    const scored: ScoredItem[] = candidateIds.map((id) => ({
      itemId: id,
      score: counts.get(id) ?? 0,
      reason: 'popularity',
    }));
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

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `popularity: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
}
