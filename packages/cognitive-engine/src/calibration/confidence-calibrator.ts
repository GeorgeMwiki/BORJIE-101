/**
 * Confidence calibrator — Discipline 3.
 *
 * Computes the `ConfidenceLabel` for a turn output using the formula
 * from COGNITIVE_ENGINE_SPEC.md §8:
 *
 *   confidence_score = 0.40 * mean_source_quality
 *                    + 0.30 * cross_source_agreement_rate
 *                    + 0.20 * corpus_consistency_rate
 *                    + 0.10 * recency_score
 *
 *   high     if score >= 0.75 AND uncited_claims = 0
 *   medium   if score >= 0.50 AND uncited_claims <= 1
 *   low      if score >= 0.30
 *   refused  otherwise
 *
 * Weights configurable per tenant via the override port (Wave WX port
 * 7). Defaults baked in here.
 *
 * @module @borjie/cognitive-engine/calibration/confidence-calibrator
 */

import type { ConfidenceLabel } from '../types.js';

export interface ConfidenceInput {
  readonly mean_source_quality: number; // 0..1
  readonly cross_source_agreement_rate: number; // 0..1
  readonly corpus_consistency_rate: number; // 0..1
  /** Median days since the cited evidence was published. */
  readonly days_since_evidence: number;
  /** Number of claim sentences that ended up uncited after rewrite. */
  readonly uncited_claims_after_rewrite: number;
}

export interface ConfidenceWeights {
  readonly w_source: number;
  readonly w_agreement: number;
  readonly w_corpus: number;
  readonly w_recency: number;
}

export const DEFAULT_WEIGHTS: ConfidenceWeights = Object.freeze({
  w_source: 0.4,
  w_agreement: 0.3,
  w_corpus: 0.2,
  w_recency: 0.1,
});

export interface ConfidenceThresholds {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = Object.freeze({
  high: 0.75,
  medium: 0.5,
  low: 0.3,
});

/** Recency curve: linear decay to 0 over 90 days. */
export const RECENCY_WINDOW_DAYS = 90;

export interface ConfidenceResult {
  readonly score: number;
  readonly label: ConfidenceLabel;
  readonly components: {
    readonly source: number;
    readonly agreement: number;
    readonly corpus: number;
    readonly recency: number;
  };
}

export function calibrateConfidence(
  input: ConfidenceInput,
  weights: ConfidenceWeights = DEFAULT_WEIGHTS,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceResult {
  const source = clamp01(input.mean_source_quality);
  const agreement = clamp01(input.cross_source_agreement_rate);
  const corpus = clamp01(input.corpus_consistency_rate);
  const recency = clamp01(
    1 - Math.max(0, input.days_since_evidence) / RECENCY_WINDOW_DAYS,
  );

  const score =
    weights.w_source * source +
    weights.w_agreement * agreement +
    weights.w_corpus * corpus +
    weights.w_recency * recency;

  const label = classify(score, input.uncited_claims_after_rewrite, thresholds);

  return {
    score,
    label,
    components: { source, agreement, corpus, recency },
  };
}

function classify(
  score: number,
  uncited: number,
  t: ConfidenceThresholds,
): ConfidenceLabel {
  if (score >= t.high && uncited === 0) return 'high';
  if (score >= t.medium && uncited <= 1) return 'medium';
  if (score >= t.low) return 'low';
  return 'refused';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Reduce a label by N tiers (used by the cite-validator's
 *  `confidence_tier_reduction`). */
export function reduceTier(
  label: ConfidenceLabel,
  by: 0 | 1 | 2,
): ConfidenceLabel {
  if (by === 0) return label;
  const order: ReadonlyArray<ConfidenceLabel> = ['high', 'medium', 'low', 'refused'];
  const idx = order.indexOf(label);
  if (idx < 0) return 'refused';
  const next = Math.min(order.length - 1, idx + by);
  return order[next] ?? 'refused';
}
