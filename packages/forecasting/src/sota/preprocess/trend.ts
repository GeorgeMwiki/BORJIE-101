/**
 * Trend detrending — linear least-squares.
 *
 * Returns the fitted line `(slope, intercept)` plus the detrended
 * series. Hodrick-Prescott is intentionally omitted from the first
 * cut — the linear baseline covers the mining-domain monthly /
 * quarterly series and avoids a numerical-stability dependency.
 *
 * @module @borjie/forecasting/sota/preprocess/trend
 */

import type { TimeSeries } from '../types.js';

export interface LinearTrend {
  readonly slope: number;
  readonly intercept: number;
  readonly detrended: ReadonlyArray<number>;
}

export function linearDetrend(series: TimeSeries): LinearTrend {
  const n = series.points.length;
  if (n < 2) {
    throw new RangeError('linearDetrend: series must have >= 2 points');
  }
  const y = series.points.map((p) => p.y);
  // x = 0..n-1 — equally-spaced index proxy.
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += y[i]!;
    sumXY += i * y[i]!;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { slope: 0, intercept: sumY / n, detrended: y.map((v) => v - sumY / n) };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const detrended = y.map((v, i) => v - (slope * i + intercept));
  return { slope, intercept, detrended };
}
