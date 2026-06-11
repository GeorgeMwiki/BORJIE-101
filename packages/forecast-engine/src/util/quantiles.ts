/**
 * Pure numeric helpers — quantiles, residual metrics, key formatting.
 *
 * No external deps. Deterministic and immutable; every function
 * returns a new value and never mutates its inputs.
 */

/**
 * Format a quantile level as a stable string key, e.g. 0.1 -> '0.1',
 * 0.95 -> '0.95'. Trailing zeros are stripped so 0.50 -> '0.5'.
 */
export function quantileKey(level: number): string {
  return String(level);
}

/**
 * Type-7 (linear interpolation) empirical quantile of a numeric
 * sample. Matches NumPy's default. Returns NaN for an empty sample.
 *
 * The input is copied + sorted so the caller's array is never mutated.
 */
export function empiricalQuantile(
  sample: ReadonlyArray<number>,
  level: number,
): number {
  const n = sample.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sample[0] as number;
  const sorted = [...sample].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, level));
  const pos = clamped * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo] as number;
  const hiVal = sorted[hi] as number;
  if (lo === hi) return loVal;
  const frac = pos - lo;
  return loVal + (hiVal - loVal) * frac;
}

/**
 * Conformal calibration quantile with the finite-sample correction
 * (Vovk et al.): the smallest score s such that at least
 * ceil((n+1)*(1-alpha)) of the n calibration scores are <= s.
 *
 * Returns +Infinity when the corrected rank exceeds n (too little
 * calibration data to guarantee coverage) — the caller then widens to
 * an unbounded interval rather than under-covering.
 */
export function conformalQuantile(
  scores: ReadonlyArray<number>,
  alpha: number,
): number {
  const n = scores.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...scores].sort((a, b) => a - b);
  const rank = Math.ceil((n + 1) * (1 - alpha));
  if (rank > n) return Number.POSITIVE_INFINITY;
  const idx = Math.max(0, Math.min(n - 1, rank - 1));
  return sorted[idx] as number;
}

/** Arithmetic mean. NaN for empty input. */
export function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Mean Absolute Scaled Error (MASE) — the scale-free accuracy metric
 * the forecasting literature recommends over MAPE.
 *
 * scale = mean absolute seasonal-naive in-sample error over `train`.
 * Returns the ratio of forecast MAE to that scale. A value < 1 means
 * the forecast beats the in-sample seasonal-naive baseline.
 *
 * Falls back to a sentinel (Infinity) when the scale is zero
 * (degenerate flat training series) so the caller treats it as
 * "cannot be scored, do not escalate".
 */
export function mase(
  actuals: ReadonlyArray<number>,
  forecasts: ReadonlyArray<number>,
  train: ReadonlyArray<number>,
  seasonLength: number,
): number {
  const m = Math.max(1, Math.floor(seasonLength));
  if (train.length <= m) return Number.POSITIVE_INFINITY;
  let scaleSum = 0;
  let scaleCount = 0;
  for (let i = m; i < train.length; i++) {
    scaleSum += Math.abs((train[i] as number) - (train[i - m] as number));
    scaleCount += 1;
  }
  const scale = scaleCount === 0 ? 0 : scaleSum / scaleCount;
  if (scale === 0) return Number.POSITIVE_INFINITY;
  const k = Math.min(actuals.length, forecasts.length);
  if (k === 0) return Number.POSITIVE_INFINITY;
  let maeSum = 0;
  for (let i = 0; i < k; i++) {
    maeSum += Math.abs((actuals[i] as number) - (forecasts[i] as number));
  }
  return maeSum / k / scale;
}

/** Mean absolute error between two equal-length-ish vectors. */
export function meanAbsoluteError(
  actuals: ReadonlyArray<number>,
  forecasts: ReadonlyArray<number>,
): number {
  const k = Math.min(actuals.length, forecasts.length);
  if (k === 0) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < k; i++) {
    sum += Math.abs((actuals[i] as number) - (forecasts[i] as number));
  }
  return sum / k;
}
