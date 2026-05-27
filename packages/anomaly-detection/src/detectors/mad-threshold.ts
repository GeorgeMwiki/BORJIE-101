/**
 * Median Absolute Deviation (MAD) threshold detector.
 *
 * Robust alternative to z-score. The MAD of `x` is
 *
 *   m = median(|x_i − median(x)|)
 *
 * and the robust z-score for a candidate `y` is
 *
 *   z_r(y) = 0.6745 · (y − median(x)) / m
 *
 * The 0.6745 factor makes `z_r` consistent with the standard normal
 * under no contamination (`0.6745 ≈ Φ⁻¹(0.75)`).
 *
 * Reference: Iglewicz, B. & Hoaglin, D. C. (1993). *How to Detect and
 * Handle Outliers.* ASQC Basic References in Quality Control vol. 16.
 * Threshold |z_r| ≥ 3.5 is the canonical cutoff recommended by
 * Iglewicz & Hoaglin.
 *
 * @module @borjie/anomaly-detection/detectors/mad-threshold
 */

import type { AnomalyScore, MadConfig } from '../types.js';

const DEFAULT_THRESHOLD = 3.5;
const MAD_NORMALITY_FACTOR = 0.6745;

interface MadParams {
  readonly median: number;
  readonly mad: number;
}

function medianOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    throw new Error('medianOf: empty vector');
  }
  // Copy before sorting — never mutate the input.
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Estimate median and MAD from a reference window.
 */
export function fitMad(values: ReadonlyArray<number>): MadParams {
  if (values.length < 2) {
    throw new Error('fitMad: at least 2 observations required');
  }
  const median = medianOf(values);
  const deviations = values.map((v) => Math.abs(v - median));
  const mad = medianOf(deviations);
  if (mad === 0) {
    throw new Error(
      'fitMad: MAD is zero (more than half the values equal the median); cannot compute robust z',
    );
  }
  return { median, mad };
}

/**
 * Score a candidate value against fitted MAD parameters.
 */
export function scoreMad(
  value: number,
  params: MadParams,
  config: MadConfig = {},
): AnomalyScore {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const score =
    (MAD_NORMALITY_FACTOR * (value - params.median)) / params.mad;
  return Object.freeze({
    value,
    score,
    scoreKind: 'mad' as const,
    threshold,
    anomalous: Math.abs(score) >= threshold,
  });
}

/**
 * Convenience — fit on the window and score a single candidate.
 */
export function detectMadAnomaly(
  window: ReadonlyArray<number>,
  candidate: number,
  config: MadConfig = {},
): AnomalyScore {
  const params = fitMad(window);
  return scoreMad(candidate, params, config);
}
