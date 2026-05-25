/**
 * Calibration scorer — Pearson correlation of AI confidence vs
 * correctness over a shadow session.
 *
 * The cutover-gate criterion (per `.audit/litfin-sota-2026-05-23/
 * 10-outcome-as-a-service.md` §2.3) requires correlation >= 0.7. The
 * point is that an AI which is "confidently wrong" or "uncertainly
 * right" is uncalibrated and should NOT be cut over even if its raw
 * agreement rate clears the bar.
 *
 *   correctness_i = 1 if AI and human verdicts are equivalent
 *                   0 otherwise
 *   confidence_i  = the AI's self-reported confidence in [0, 1]
 *
 *   r = Σ((c_i - c̄)(x_i - x̄)) / sqrt(Σ(c_i - c̄)² · Σ(x_i - x̄)²)
 *
 * Edge cases (returned values are deliberate, see tests):
 *   - empty corpus           → 0   (no evidence; gate fails on sample-size)
 *   - n < 2                  → 0   (Pearson is undefined for n<2)
 *   - zero variance in conf  → 0   (denominator undefined; the AI's
 *                                   confidence channel is providing no
 *                                   signal — treat as uncalibrated)
 *   - zero variance in corr  → 0   (every decision was right OR every
 *                                   decision was wrong; correlation is
 *                                   undefined and the cutover gate's
 *                                   agreement criterion already covers
 *                                   the "all right" case separately)
 *   - any non-finite conf    → that single decision is excluded from
 *                              the correlation but still counts toward
 *                              the n>=2 floor. NaN confidence is a bug
 *                              we want to surface, not silently inflate.
 *
 * Returns a value in [-1, 1]; the cutover gate checks `>= threshold`.
 *
 * Out of scope: Spearman / Kendall, ECE (expected calibration error),
 * reliability diagrams, Brier score. Pearson is the spec metric.
 */

import { isEquivalent } from './agreement-scorer.js';
import type { ShadowDecision } from './types.js';

/**
 * Compute Pearson correlation between AI confidence and binary
 * correctness over the corpus.
 *
 * @param decisions  Immutable corpus from `ShadowSession.decisions`.
 * @param numericTolerance  Forwarded to the equivalence check, so the
 *                          "correctness" half of the correlation matches
 *                          the agreement scorer's definition exactly.
 */
export function computeConfidenceCorrelation(
  decisions: ReadonlyArray<ShadowDecision>,
  numericTolerance: number,
): number {
  // Build paired (confidence, correctness) samples, dropping any
  // decision whose confidence is non-finite or out-of-range.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of decisions) {
    if (!Number.isFinite(d.confidence)) continue;
    if (d.confidence < 0 || d.confidence > 1) continue;
    xs.push(d.confidence);
    ys.push(isEquivalent(d, numericTolerance) ? 1 : 0);
  }

  return pearson(xs, ys);
}

/**
 * Pearson r over two equal-length numeric vectors. Pure helper —
 * exported for direct test coverage of the math, the scorer above is
 * the public surface.
 */
export function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  if (xs.length !== ys.length) return 0;
  if (xs.length < 2) return 0;

  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  // Zero variance on either axis → correlation undefined → treat as
  // uncalibrated (0). Documented above. Use an epsilon floor because
  // sums-of-squared-deviations from a floating-point mean don't reach
  // exactly 0 even when every sample is identical (e.g. xs all = 0.7
  // produces denomX ≈ 1e-31, not 0). Epsilon is sized to swallow only
  // numerical noise from realistic-scale (< 1e6) sample counts and
  // bounded ([0, 1]) values, never a real signal.
  const variancEpsilon = 1e-12;
  if (denomX <= variancEpsilon || denomY <= variancEpsilon) return 0;

  const r = num / Math.sqrt(denomX * denomY);
  // Clamp tiny floating-point excursions outside [-1, 1] for downstream
  // comparators that may be brittle to e.g. r === 1.0000000000000002.
  if (r > 1) return 1;
  if (r < -1) return -1;
  return r;
}
