/**
 * z-score threshold detector.
 *
 * Classical 3-sigma rule: `z = (x − μ) / σ`. The detector trains on a
 * reference window and scores any candidate by its absolute z-score.
 *
 * Limitations: the sample mean and standard deviation are themselves
 * sensitive to outliers — if the training window is contaminated the
 * detector will under-flag. Prefer `mad-threshold.ts` when contamination
 * is plausible.
 *
 * Reference: textbook, e.g. NIST/SEMATECH e-Handbook of Statistical
 * Methods §1.3.5.17 "Detection of Outliers" — Grubbs test.
 *
 * @module @borjie/anomaly-detection/detectors/zscore-threshold
 */

import type { AnomalyScore, ZScoreConfig } from '../types.js';

const DEFAULT_THRESHOLD = 3;

interface ZScoreParams {
  readonly mu: number;
  readonly sigma: number;
}

/**
 * Estimate `μ` and `σ` from a reference window via Welford's online
 * algorithm — numerically stable across long windows.
 */
export function fitZScore(values: ReadonlyArray<number>): ZScoreParams {
  if (values.length < 2) {
    throw new Error(
      'fitZScore: at least 2 observations required to estimate sigma',
    );
  }
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (const v of values) {
    n += 1;
    const delta = v - mean;
    mean += delta / n;
    m2 += delta * (v - mean);
  }
  const variance = m2 / (n - 1);
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma) || sigma === 0) {
    throw new Error(
      'fitZScore: sigma is zero or non-finite; cannot compute z-scores',
    );
  }
  return { mu: mean, sigma };
}

/**
 * Score a candidate value against fitted parameters.
 */
export function scoreZ(
  value: number,
  params: ZScoreParams,
  config: ZScoreConfig = {},
): AnomalyScore {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const score = (value - params.mu) / params.sigma;
  return Object.freeze({
    value,
    score,
    scoreKind: 'zscore' as const,
    threshold,
    anomalous: Math.abs(score) >= threshold,
  });
}

/**
 * Convenience — fit on the window and score a single candidate.
 */
export function detectZScoreAnomaly(
  window: ReadonlyArray<number>,
  candidate: number,
  config: ZScoreConfig = {},
): AnomalyScore {
  const params = fitZScore(window);
  return scoreZ(candidate, params, config);
}
