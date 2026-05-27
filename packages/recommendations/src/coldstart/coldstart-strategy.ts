/**
 * Cold-start router.
 *
 * Decision logic — strictly tenant-scoped, never falls back to a
 * cross-tenant store:
 *
 *   Let userInteractions = count of interactions where ix.userId ==
 *   request.userId and ix.tenantId == request.tenantId.
 *
 *   - If userInteractions < cfThreshold        → content-based if we
 *     have item embeddings AND (positive user interactions OR a user
 *     embedding); else popularity.
 *   - If userInteractions < contentBasedThreshold → same as above
 *     (content if available, popularity otherwise).
 *   - Otherwise → cf.
 *
 * This three-rung ladder is the SOTA-RECO spec's "popularity →
 * content → CF" router. The injected `cf` recommender lets callers
 * pick user-user, item-item, or matrix-factorization without
 * touching the router.
 *
 * Citation: Schein, Popescul, Ungar, Pennock — "Methods and Metrics
 * for Cold-Start Recommendations", SIGIR 2002 (canonical baseline;
 * re-issued in the Recommender Systems Handbook 3rd ed., 2024).
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
} from '../types.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'coldstart_router' as const;

export interface ColdstartOptions {
  readonly popularity: RecommendationPort;
  readonly content: RecommendationPort;
  readonly cf: RecommendationPort;
  /** User interaction count below which we route to content-based.
   *  Default 3. */
  readonly contentBasedThreshold?: number;
  /** User interaction count below which we route to popularity.
   *  Must be <= contentBasedThreshold. Default 1. */
  readonly cfThreshold?: number;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

export interface ColdstartRouter extends RecommendationPort {
  /** Return the routing decision a request would receive without
   *  actually running the recommender. Useful for telemetry. */
  decide(request: RecommendationRequest): 'popularity' | 'content_based' | 'cf';
}

export function createColdstartRouter(opts: ColdstartOptions): ColdstartRouter {
  const contentThreshold = opts.contentBasedThreshold ?? 3;
  const cfThreshold = opts.cfThreshold ?? 1;
  if (cfThreshold > contentThreshold) {
    throw new Error(
      `coldstart: cfThreshold (${cfThreshold}) must be <= contentBasedThreshold (${contentThreshold})`,
    );
  }
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function decide(
    request: RecommendationRequest,
  ): 'popularity' | 'content_based' | 'cf' {
    let userInteractions = 0;
    let userPositive = 0;
    for (const ix of request.interactions) {
      if (ix.tenantId !== request.tenantId) continue;
      if (ix.userId !== request.userId) continue;
      userInteractions += 1;
      if (ix.rating > 0) userPositive += 1;
    }
    const hasUserEmbedding = Boolean(request.user?.embedding);
    const hasCandidateEmbeddings = request.candidates.some((c) =>
      Boolean(c.embedding),
    );
    const canContent =
      hasCandidateEmbeddings && (userPositive > 0 || hasUserEmbedding);
    if (userInteractions < cfThreshold) {
      return canContent ? 'content_based' : 'popularity';
    }
    if (userInteractions < contentThreshold) {
      return canContent ? 'content_based' : 'popularity';
    }
    return 'cf';
  }

  function recommend(request: RecommendationRequest): RecommendationResult {
    const decision = decide(request);
    const underlying =
      decision === 'cf'
        ? opts.cf
        : decision === 'content_based'
          ? opts.content
          : opts.popularity;
    const result = underlying.recommend(request);
    return sealResult({
      tenantId: request.tenantId,
      target: request.target,
      algorithm: ALGORITHM,
      userId: request.userId,
      topK: result.topK.map((s) => ({
        itemId: s.itemId,
        score: s.score,
        reason: `coldstart→${decision}: ${s.reason ?? ''}`.trim(),
      })),
      candidates: result.candidates,
      servedAt: now(),
      prevHash,
    });
  }

  return { algorithm: ALGORITHM, recommend, decide };
}
