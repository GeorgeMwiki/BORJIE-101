/**
 * Mining-domain wrappers — Mr. Mwikila's operator-facing API.
 *
 * Five flows:
 *
 *   - buyerMineMatch:                buyer ↔ producing pit
 *   - workerSiteMatch:               worker ↔ site / shift
 *   - regulatorFilingMatch:          regulator ↔ filing
 *   - supplierMineMatch:             supplier ↔ pit
 *   - trainingCourseWorkerMatch:     course ↔ worker
 *
 * Each wrapper:
 *   1. Validates the request (target, tenant, non-empty topK).
 *   2. Picks an algorithm per spec (see RECOMMENDATIONS_SOTA_2026.md
 *      section 7).
 *   3. Applies MMR diversity with a target-specific lambda.
 *   4. Returns the standard `RecommendationResult` envelope.
 *
 * The wrappers do NOT persist the run; persistence is the caller's
 * decision (the HTTP/RPC layer wraps the call in a transaction so
 * the run + downstream side-effects commit together).
 */

import { createContentBasedRecommender } from '../algorithms/content-based.js';
import { createItemItemCFRecommender } from '../algorithms/item-item-cf.js';
import { createMatrixFactorizationRecommender } from '../algorithms/matrix-factorization.js';
import { createPopularityRecommender } from '../algorithms/popularity.js';
import { createColdstartRouter } from '../coldstart/coldstart-strategy.js';
import { rerankMMR } from '../diversity/mmr.js';
import { createLogger } from '../logger.js';
import type {
  AlgorithmTag,
  MatchTarget,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
} from '../types.js';
import { sealResult } from '../util/seal.js';

const log = createLogger('domain/mining-reco');

export interface MiningRecoOptions {
  /** Now-clock. Default Date.now. */
  readonly now?: () => number;
}

function targetGuard(
  request: RecommendationRequest,
  expected: MatchTarget,
): void {
  if (request.target !== expected) {
    throw new Error(
      `mining-reco: expected target ${expected}, got ${request.target}`,
    );
  }
  if (request.tenantId.length === 0) {
    throw new Error('mining-reco: empty tenantId');
  }
  if (request.topK <= 0) {
    throw new Error(`mining-reco: topK must be > 0, got ${request.topK}`);
  }
}

function applyMMRAndSeal(args: {
  readonly request: RecommendationRequest;
  readonly algorithm: AlgorithmTag;
  readonly base: ReadonlyArray<ScoredItem>;
  readonly lambda: number;
  readonly now: () => number;
}): RecommendationResult {
  const reranked = rerankMMR(args.base, args.request.candidates, {
    lambda: args.lambda,
    topK: args.request.topK,
  });
  return sealResult({
    tenantId: args.request.tenantId,
    target: args.request.target,
    algorithm: args.algorithm,
    userId: args.request.userId,
    topK: reranked,
    candidates: args.request.candidates.map((c) => c.id),
    servedAt: args.now(),
  });
}

/** buyer ↔ producing pit. Content + matrix-fac ensemble; MMR λ=0.7. */
export function buyerMineMatch(
  request: RecommendationRequest,
  opts: MiningRecoOptions = {},
): RecommendationResult {
  targetGuard(request, 'buyer_mine');
  const now = opts.now ?? ((): number => Date.now());
  const content = createContentBasedRecommender({ now }).recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  const mf = createMatrixFactorizationRecommender({ now }).recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  const ensemble = ensembleScores([
    { weight: 0.5, scored: content.topK },
    { weight: 0.5, scored: mf.topK },
  ]);
  log.debug('buyerMineMatch ensemble built', {
    tenantId: request.tenantId,
    candidates: request.candidates.length,
  });
  return applyMMRAndSeal({
    request,
    algorithm: 'ensemble:content_based,matrix_factorization',
    base: ensemble,
    lambda: 0.7,
    now,
  });
}

/** worker ↔ site. Item-item CF; MMR λ=0.6. */
export function workerSiteMatch(
  request: RecommendationRequest,
  opts: MiningRecoOptions = {},
): RecommendationResult {
  targetGuard(request, 'worker_site');
  const now = opts.now ?? ((): number => Date.now());
  const cf = createItemItemCFRecommender({ now }).recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  return applyMMRAndSeal({
    request,
    algorithm: 'item_item_cf',
    base: cf.topK,
    lambda: 0.6,
    now,
  });
}

/** regulator ↔ filing. Content-based; MMR λ=0.8 (diversity less critical
 *  inside one jurisdiction). */
export function regulatorFilingMatch(
  request: RecommendationRequest,
  opts: MiningRecoOptions = {},
): RecommendationResult {
  targetGuard(request, 'regulator_filing');
  const now = opts.now ?? ((): number => Date.now());
  const content = createContentBasedRecommender({ now }).recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  return applyMMRAndSeal({
    request,
    algorithm: 'content_based',
    base: content.topK,
    lambda: 0.8,
    now,
  });
}

/** supplier ↔ mine. Matrix factorization; MMR λ=0.5. */
export function supplierMineMatch(
  request: RecommendationRequest,
  opts: MiningRecoOptions = {},
): RecommendationResult {
  targetGuard(request, 'supplier_mine');
  const now = opts.now ?? ((): number => Date.now());
  const mf = createMatrixFactorizationRecommender({ now }).recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  return applyMMRAndSeal({
    request,
    algorithm: 'matrix_factorization',
    base: mf.topK,
    lambda: 0.5,
    now,
  });
}

/** training-course ↔ worker. Cold-start router (most workers are
 *  net-new every quarter). MMR λ=0.65. */
export function trainingCourseWorkerMatch(
  request: RecommendationRequest,
  opts: MiningRecoOptions = {},
): RecommendationResult {
  targetGuard(request, 'course_worker');
  const now = opts.now ?? ((): number => Date.now());
  const router = createColdstartRouter({
    popularity: createPopularityRecommender({ now }),
    content: createContentBasedRecommender({ now }),
    cf: createItemItemCFRecommender({ now }),
    now,
  });
  const out = router.recommend({
    ...request,
    topK: Math.max(request.topK * 3, 10),
  });
  return applyMMRAndSeal({
    request,
    algorithm: 'coldstart_router',
    base: out.topK,
    lambda: 0.65,
    now,
  });
}

/**
 * Merge multiple recommender outputs into a single scored list,
 * normalising scores to [0, 1] within each input first, then
 * weight-averaging across inputs. The normalisation is per-input
 * min-max; for a degenerate single-value range we emit 0.5 so the
 * input still contributes a centred signal to the average.
 */
function ensembleScores(
  inputs: ReadonlyArray<{
    readonly weight: number;
    readonly scored: ReadonlyArray<ScoredItem>;
  }>,
): ScoredItem[] {
  interface Acc {
    sum: number;
    weight: number;
    reasons: string[];
  }
  const totals = new Map<string, Acc>();
  for (const input of inputs) {
    if (input.scored.length === 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of input.scored) {
      if (s.score < lo) lo = s.score;
      if (s.score > hi) hi = s.score;
    }
    const span = hi - lo;
    for (const s of input.scored) {
      const normalised = span === 0 ? 0.5 : (s.score - lo) / span;
      const acc = totals.get(s.itemId) ?? { sum: 0, weight: 0, reasons: [] };
      acc.sum += normalised * input.weight;
      acc.weight += input.weight;
      if (s.reason) acc.reasons.push(s.reason);
      totals.set(s.itemId, acc);
    }
  }
  const out: ScoredItem[] = [];
  for (const [itemId, acc] of totals) {
    const score = acc.weight === 0 ? 0 : acc.sum / acc.weight;
    out.push({
      itemId,
      score,
      reason:
        acc.reasons.length === 0
          ? 'ensemble'
          : `ensemble: ${acc.reasons.join(' | ')}`,
    });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
  });
  return out;
}
