/**
 * LLM-based reranker port.
 *
 * The retrieval layer (matrix-factorization, two-tower, content-based)
 * produces an initial top-N. The LLM reranker port then re-orders
 * that top-N using a structured prompt — typically Claude or
 * Gemini — and returns the final top-K. We **port** this; the
 * production wiring lives in a sidecar so latency budgets are
 * predictable and the LLM call is observable / rate-limited.
 *
 * The deterministic mock implementation below preserves the input
 * order — useful for unit tests where we want to verify the port
 * contract but not pay for an LLM call.
 *
 * Citation: Hou, Zhang et al. — "Large Language Models are Zero-Shot
 * Rankers for Recommender Systems", ECIR 2024 / arXiv:2305.07001.
 * Establishes the LLM-as-reranker pattern as the production-grade
 * 2024-2025 default for the rerank stage.
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
} from '../types.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'llm_rerank' as const;

/** The injected LLM port. Tests and offline runs pass a deterministic
 *  mock; production passes a Claude / Gemini adapter. */
export interface LLMRerankerPort {
  rerank(args: LLMRerankRequest): Promise<LLMRerankResponse>;
}

export interface LLMRerankRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly target: string;
  readonly candidates: ReadonlyArray<{
    itemId: string;
    baseScore: number;
    reason?: string;
  }>;
  readonly topK: number;
}

export interface LLMRerankResponse {
  readonly ranked: ReadonlyArray<{
    itemId: string;
    score: number;
    reason?: string;
  }>;
}

export interface LLMRerankRecommenderOptions {
  /** The base recommender whose top-N is fed to the LLM. */
  readonly base: RecommendationPort;
  /** The LLM port. */
  readonly llm: LLMRerankerPort;
  /** Number of candidates to send to the LLM (must be >= request.topK). */
  readonly poolSize?: number;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

export function createLLMRerankRecommender(
  opts: LLMRerankRecommenderOptions,
): RecommendationPort & {
  recommendAsync(req: RecommendationRequest): Promise<RecommendationResult>;
} {
  const poolSize = opts.poolSize ?? 25;
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  async function recommendAsync(
    request: RecommendationRequest,
  ): Promise<RecommendationResult> {
    const baseTop = opts.base.recommend({
      ...request,
      topK: Math.max(request.topK, poolSize),
    });
    const pool = baseTop.topK.slice(0, poolSize);
    const resp = await opts.llm.rerank({
      tenantId: request.tenantId,
      userId: request.userId,
      target: request.target,
      candidates: pool.map((p) => ({
        itemId: p.itemId,
        baseScore: p.score,
        ...(p.reason !== undefined ? { reason: p.reason } : {}),
      })),
      topK: request.topK,
    });
    const reranked = resp.ranked.slice(0, request.topK).map((r) => ({
      itemId: r.itemId,
      score: r.score,
      reason: r.reason ?? 'llm_rerank',
    }));
    return sealResult({
      tenantId: request.tenantId,
      target: request.target,
      algorithm: ALGORITHM,
      userId: request.userId,
      topK: reranked,
      candidates: request.candidates.map((c) => c.id),
      servedAt: now(),
      prevHash,
    });
  }

  function recommend(_request: RecommendationRequest): RecommendationResult {
    throw new Error(
      'llm_rerank: this recommender is async. Call recommendAsync instead of recommend.',
    );
  }

  return { algorithm: ALGORITHM, recommend, recommendAsync };
}

/** Deterministic mock — preserves the base order, used in tests. */
export function createDeterministicMockLLM(): LLMRerankerPort {
  return {
    async rerank(args: LLMRerankRequest): Promise<LLMRerankResponse> {
      return {
        ranked: args.candidates.slice(0, args.topK).map((c) => ({
          itemId: c.itemId,
          score: c.baseScore,
          reason: 'llm_rerank: mock identity',
        })),
      };
    },
  };
}
