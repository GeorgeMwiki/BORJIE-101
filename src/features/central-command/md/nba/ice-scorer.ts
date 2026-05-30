/**
 * ICE scorer — Impact x Confidence x Ease.
 *
 * Pure functions only. Inputs are never mutated; outputs are fresh objects.
 * Reference: Sean Ellis (GrowthHackers) ICE framework. Values returned are
 *   - impact:     0..10
 *   - confidence: 0..1
 *   - ease:       0..10
 *   - ice:        impact * confidence * ease  (max = 100)
 *
 * @module features/central-command/md/nba/ice-scorer
 */

import type { ActionCandidate, IceScore } from "./types";

/** Clamp value into [lo, hi]. Pure. */
export function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Compute the ICE score for a candidate action.
 *
 * Lifts (from `ActionCandidate.contextualImpactLift` and
 * `contextualConfidenceLift`) are added to the template baselines. Ease is
 * derived from the effort bucket if the baseline is missing.
 */
export function scoreIce(candidate: ActionCandidate): IceScore {
  const { template, contextualImpactLift, contextualConfidenceLift } =
    candidate;

  const impact = clamp(template.baselineImpact + contextualImpactLift, 0, 10);
  const confidence = clamp(
    template.baselineConfidence + contextualConfidenceLift,
    0,
    1,
  );
  const ease = clamp(template.baselineEase, 0, 10);

  const ice = round(impact * confidence * ease, 3);

  return Object.freeze({ impact, confidence, ease, ice });
}

/** Round to N decimal places without mutating math semantics. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Convenience: compute raw ICE from three primitives. Useful in tests and
 * when callers want to skip the candidate envelope.
 */
export function computeIce(
  impact: number,
  confidence: number,
  ease: number,
): number {
  const i = clamp(impact, 0, 10);
  const c = clamp(confidence, 0, 1);
  const e = clamp(ease, 0, 10);
  return round(i * c * e, 3);
}
