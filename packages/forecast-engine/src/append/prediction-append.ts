/**
 * Prediction-APPEND port.
 *
 * HARD RAIL (CLAUDE.md): "Predictions APPEND to rule-based decisions.
 * Never replace." This port emits a forecast AS an advisory prediction
 * that wraps — and never overwrites — an authoritative rule-based
 * decision. The brain can later consume this (e.g. via
 * `wrapWritesWithOutcomePrediction`); we only EXPORT the port here and
 * do NOT wire it into the brain.
 *
 * The append is structurally enforced: `appendForecastPrediction` takes
 * the immutable rule-based decision and returns a NEW envelope that
 * carries the original decision UNCHANGED under `ruleBasedDecision`,
 * plus the advisory forecast under `prediction`. There is no code path
 * that mutates or returns the decision in a modified form.
 *
 * Every appended prediction is stamped with >=1 evidence_id; an empty
 * evidence chain throws (the Auditor rejects it downstream anyway, but
 * we fail loud at the seam).
 *
 * Pure + immutable.
 */

import { z } from 'zod';
import type { EvidenceId, ForecastResult } from '../types.js';
import { EvidenceIdSchema } from '../types.js';

/**
 * The authoritative rule-based decision the forecast appends to.
 * `decision` is opaque (any rule output); the engine never inspects or
 * changes it.
 */
export interface RuleBasedDecision<TDecision = unknown> {
  /** Stable id of the rule-based decision. */
  readonly decisionId: string;
  /** The rule that produced it, e.g. 'royalty.A6.statutory_formula'. */
  readonly rule: string;
  /** The authoritative decision payload — treated as opaque + final. */
  readonly decision: TDecision;
}

/**
 * The advisory prediction extracted from a `ForecastResult`. Carries
 * the median path, the calibrated intervals, evidence, and the
 * floor-beating flag — everything a consumer needs to weigh it WITHOUT
 * touching the rule-based decision.
 */
export interface AdvisoryPrediction {
  readonly forecastId: string;
  readonly target: string;
  readonly horizon: number;
  /** Median path (p50 per step). */
  readonly median: ReadonlyArray<number>;
  /** Calibrated lower/upper per step. */
  readonly lower: ReadonlyArray<number>;
  readonly upper: ReadonlyArray<number>;
  readonly conformalCoverage: number;
  readonly baselineBeaten: boolean;
  readonly evidenceIds: ReadonlyArray<EvidenceId>;
  /** Always 'advisory' — this prediction never has decision authority. */
  readonly authority: 'advisory';
}

/**
 * The append envelope: the rule-based decision UNCHANGED + the advisory
 * prediction alongside it. This is the literal embodiment of
 * "predictions APPEND".
 */
export interface AppendedForecastEnvelope<TDecision = unknown> {
  /** The authoritative decision — byte-for-byte unchanged. */
  readonly ruleBasedDecision: RuleBasedDecision<TDecision>;
  /** The advisory forecast appended alongside it. */
  readonly prediction: AdvisoryPrediction;
  /** Discriminant making the append explicit + auditable. */
  readonly mode: 'append';
}

export const AdvisoryPredictionSchema: z.ZodType<AdvisoryPrediction> = z.object({
  forecastId: z.string().min(1),
  target: z.string().min(1),
  horizon: z.number().int().min(1),
  median: z.array(z.number()),
  lower: z.array(z.number()),
  upper: z.array(z.number()),
  conformalCoverage: z.number().gt(0).lt(1),
  baselineBeaten: z.boolean(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  authority: z.literal('advisory'),
}) as unknown as z.ZodType<AdvisoryPrediction>;

/**
 * Convert a `ForecastResult` into an `AppendedForecastEnvelope` around a
 * rule-based decision. The decision is carried through UNCHANGED.
 *
 * @throws if the forecast has no evidence ids (empty chain).
 */
export function appendForecastPrediction<TDecision>(
  decision: RuleBasedDecision<TDecision>,
  forecast: ForecastResult,
): AppendedForecastEnvelope<TDecision> {
  if (forecast.evidenceIds.length === 0) {
    throw new Error(
      `forecast ${forecast.forecastId} has an empty evidence chain — cannot append`,
    );
  }
  const prediction: AdvisoryPrediction = {
    forecastId: forecast.forecastId,
    target: forecast.target,
    horizon: forecast.horizon,
    median: forecast.points.map((p) => p.point),
    lower: forecast.intervals.map((i) => i.lower),
    upper: forecast.intervals.map((i) => i.upper),
    conformalCoverage: forecast.conformalCoverage,
    baselineBeaten: forecast.baselineBeaten,
    evidenceIds: forecast.evidenceIds,
    authority: 'advisory',
  };
  return {
    // Spread does NOT clone deeply; the decision object reference is the
    // original, untouched. We never write to it.
    ruleBasedDecision: decision,
    prediction,
    mode: 'append',
  };
}
