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
  /**
   * Live calibrated alpha (rejection rate, [0..1]) from the online conformal
   * coverage-feedback loop (`@borjie/conformal-calibration-online`). OPTIONAL —
   * when omitted the static `thresholds` are used unchanged (cold-start /
   * conformal-off behaviour is identical to before).
   *
   * When supplied, the alpha SHIFTS the high/medium/low thresholds relative to
   * the package's baseline alpha (`CONFORMAL_BASELINE_ALPHA`). The interval's
   * target coverage is `1 - alpha`:
   *   - alpha ABOVE baseline → the model was OVER-covering (intervals too wide /
   *     too cautious) → RELAX (lower) thresholds so well-grounded outputs clear
   *     a higher tier.
   *   - alpha BELOW baseline → the model was UNDER-covering (intervals too
   *     narrow) → TIGHTEN (raise) thresholds so the brain demands more evidence
   *     before claiming a tier.
   * The shift is bounded by `CONFORMAL_MAX_THRESHOLD_SHIFT` and the resulting
   * thresholds are clamped to [0,1] and re-ordered (high ≥ medium ≥ low).
   */
  readonly calibrated_alpha?: number;
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

/**
 * Baseline alpha the conformal package initialises to
 * (`DEFAULT_INITIAL_ALPHA` in `@borjie/conformal-calibration-online`). The live
 * calibrated alpha is compared against THIS to decide whether the model is over-
 * or under-covering. Mirrored locally so cognitive-engine never imports the
 * conformal package (keeps this module dependency-free).
 */
export const CONFORMAL_BASELINE_ALPHA = 0.1;

/**
 * Sensitivity: each unit of (alpha − baseline) moves the thresholds by this
 * much, before clamping. With a [0.01, 0.5] alpha range the raw shift spans
 * roughly [-0.08, +0.4] before the cap below.
 */
export const CONFORMAL_THRESHOLD_GAIN = 1.0;

/**
 * Hard cap on how far the calibrated alpha may move any threshold, so a wildly
 * drifting loop can never collapse the tiers entirely.
 */
export const CONFORMAL_MAX_THRESHOLD_SHIFT = 0.15;

/**
 * Derive conformal-adjusted thresholds from a base set + a live calibrated
 * alpha. Pure. When `calibratedAlpha` is undefined the base thresholds are
 * returned untouched.
 *
 * Direction: a HIGHER alpha than baseline means the model was over-covering
 * (too cautious) → we LOWER the thresholds (more outputs clear a tier). A LOWER
 * alpha means under-covering → we RAISE the thresholds (stricter). Hence the
 * shift is subtracted: `shift = clamp(gain * (alpha - baseline), ±cap)` and
 * each threshold becomes `base - shift`. Results are clamped to [0,1] and
 * re-ordered so the high ≥ medium ≥ low invariant always holds.
 */
export function conformalAdjustedThresholds(
  base: ConfidenceThresholds,
  calibratedAlpha: number | undefined,
): ConfidenceThresholds {
  if (
    calibratedAlpha === undefined ||
    Number.isNaN(calibratedAlpha)
  ) {
    return base;
  }
  const alpha = clamp01(calibratedAlpha);
  const rawShift = CONFORMAL_THRESHOLD_GAIN * (alpha - CONFORMAL_BASELINE_ALPHA);
  const shift = Math.max(
    -CONFORMAL_MAX_THRESHOLD_SHIFT,
    Math.min(CONFORMAL_MAX_THRESHOLD_SHIFT, rawShift),
  );
  const high = clamp01(base.high - shift);
  const medium = clamp01(base.medium - shift);
  const low = clamp01(base.low - shift);
  // Preserve the high ≥ medium ≥ low ordering after clamping.
  const orderedMedium = Math.min(medium, high);
  const orderedLow = Math.min(low, orderedMedium);
  return { high, medium: orderedMedium, low: orderedLow };
}

export interface ConfidenceResult {
  readonly score: number;
  readonly label: ConfidenceLabel;
  readonly components: {
    readonly source: number;
    readonly agreement: number;
    readonly corpus: number;
    readonly recency: number;
  };
  /**
   * The thresholds actually used to classify this turn — equal to the base
   * `thresholds` unless `input.calibrated_alpha` shifted them. Exposed so the
   * audit trail / admin dashboards can show the conformal loop's live effect.
   */
  readonly effectiveThresholds: ConfidenceThresholds;
  /** Echo of the calibrated alpha applied (undefined when none was supplied). */
  readonly calibratedAlpha?: number;
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

  // The live conformal alpha (when supplied) shifts the thresholds BEFORE
  // classification — this is where the calibrated alpha changes the confidence
  // OUTPUT, not just the audit metadata.
  const effectiveThresholds = conformalAdjustedThresholds(
    thresholds,
    input.calibrated_alpha,
  );

  const label = classify(
    score,
    input.uncited_claims_after_rewrite,
    effectiveThresholds,
  );

  return {
    score,
    label,
    components: { source, agreement, corpus, recency },
    effectiveThresholds,
    ...(input.calibrated_alpha !== undefined
      ? { calibratedAlpha: input.calibrated_alpha }
      : {}),
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
