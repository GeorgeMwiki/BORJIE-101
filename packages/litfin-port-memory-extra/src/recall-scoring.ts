/**
 * Recall scoring — predict-then-verify for low-confidence recalls.
 *
 * LITFIN ref: src/core/memory/memory-service.ts +
 * src/core/litfin-ai/calibration/* — emits a calibrated confidence and
 * gates verification on a configurable acceptance threshold. Below the
 * threshold, the caller is told to run verification (e.g. re-query KG,
 * call out to expert, ask user).
 */

export interface RecallCandidate<T> {
  readonly value: T;
  /** Raw retriever score (e.g. cosine, BM25). */
  readonly retrievalScore: number;
  /** Optional cross-encoder rerank score in [0,1]. */
  readonly rerankScore?: number;
  /** Optional prior — how often this fact has been verified true. */
  readonly historicalPrecision?: number;
}

export interface RecallScoringConfig {
  /** Floor that bypasses verification. */
  readonly autoAcceptThreshold: number;
  /** Floor that bypasses recall entirely (drop). */
  readonly rejectThreshold: number;
  /** Weights for blending sub-scores. Must sum to ~1. */
  readonly weights: {
    readonly retrieval: number;
    readonly rerank: number;
    readonly precision: number;
  };
}

export const DEFAULT_RECALL_CONFIG: RecallScoringConfig = {
  autoAcceptThreshold: 0.82,
  rejectThreshold: 0.35,
  weights: { retrieval: 0.45, rerank: 0.35, precision: 0.2 },
};

export type RecallVerdict = 'auto-accept' | 'verify' | 'reject';

export interface ScoredRecall<T> {
  readonly value: T;
  readonly confidence: number;
  readonly verdict: RecallVerdict;
  readonly reason: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const scoreRecall = <T>(
  candidate: RecallCandidate<T>,
  cfg: RecallScoringConfig = DEFAULT_RECALL_CONFIG,
): ScoredRecall<T> => {
  const r = clamp01(candidate.retrievalScore);
  const rk = clamp01(candidate.rerankScore ?? candidate.retrievalScore);
  const p = clamp01(candidate.historicalPrecision ?? 0.5); // weak prior
  const w = cfg.weights;
  const blended = clamp01(w.retrieval * r + w.rerank * rk + w.precision * p);
  if (blended >= cfg.autoAcceptThreshold) {
    return {
      value: candidate.value,
      confidence: blended,
      verdict: 'auto-accept',
      reason: `confidence>=${cfg.autoAcceptThreshold}`,
    };
  }
  if (blended < cfg.rejectThreshold) {
    return {
      value: candidate.value,
      confidence: blended,
      verdict: 'reject',
      reason: `confidence<${cfg.rejectThreshold}`,
    };
  }
  return {
    value: candidate.value,
    confidence: blended,
    verdict: 'verify',
    reason: 'in-uncertainty-band',
  };
};

export interface BatchPartition<T> {
  readonly autoAccepted: readonly ScoredRecall<T>[];
  readonly toVerify: readonly ScoredRecall<T>[];
  readonly rejected: readonly ScoredRecall<T>[];
}

export const scoreBatch = <T>(
  candidates: readonly RecallCandidate<T>[],
  cfg: RecallScoringConfig = DEFAULT_RECALL_CONFIG,
): BatchPartition<T> => {
  const scored = candidates.map((c) => scoreRecall(c, cfg));
  return {
    autoAccepted: scored.filter((s) => s.verdict === 'auto-accept'),
    toVerify: scored.filter((s) => s.verdict === 'verify'),
    rejected: scored.filter((s) => s.verdict === 'reject'),
  };
};
