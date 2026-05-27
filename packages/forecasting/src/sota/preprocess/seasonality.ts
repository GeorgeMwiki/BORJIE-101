/**
 * Seasonal decomposition — STL-style additive.
 *
 * Splits y = trend + seasonal + residual using a centred-moving-average
 * trend with period `m`. The seasonal index for each phase is the mean
 * of (y - trend) at that phase across all observed cycles. The
 * residual is the leftover.
 *
 * Pure-TS, no LAPACK dependency. Reference: Hyndman & Athanasopoulos
 * (3rd ed.) section 3.4 ("Classical decomposition").
 *
 * @module @borjie/forecasting/sota/preprocess/seasonality
 */

import type { TimeSeries } from '../types.js';

export interface SeasonalDecomposition {
  readonly trend: ReadonlyArray<number | null>;
  readonly seasonal: ReadonlyArray<number>;
  readonly residual: ReadonlyArray<number | null>;
  readonly period: number;
}

export function decomposeSeasonality(
  series: TimeSeries,
  period: number,
): SeasonalDecomposition {
  if (period < 2) {
    throw new RangeError(
      `decomposeSeasonality: period must be >= 2, got ${period}`,
    );
  }
  const y = series.points.map((p) => p.y);
  const n = y.length;
  if (n < 2 * period) {
    throw new RangeError(
      `decomposeSeasonality: series too short — need >= ${2 * period}, got ${n}`,
    );
  }
  // Step 1: centred moving-average trend of width `period` (or
  // `period+1` for even).
  const half = Math.floor(period / 2);
  const trend: Array<number | null> = new Array(n).fill(null);
  if (period % 2 === 0) {
    for (let i = half; i < n - half; i += 1) {
      let sum = 0;
      let count = 0;
      // 2xMA for even periods: average two adjacent MAs.
      for (let k = -half; k <= half; k += 1) {
        const w = k === -half || k === half ? 0.5 : 1;
        sum += w * y[i + k]!;
        count += w;
      }
      trend[i] = sum / count;
    }
  } else {
    for (let i = half; i < n - half; i += 1) {
      let sum = 0;
      for (let k = -half; k <= half; k += 1) sum += y[i + k]!;
      trend[i] = sum / period;
    }
  }
  // Step 2: seasonal indices — mean detrended value at each phase.
  const phaseSums: number[] = new Array(period).fill(0);
  const phaseCounts: number[] = new Array(period).fill(0);
  for (let i = 0; i < n; i += 1) {
    const tr = trend[i];
    if (tr === null) continue;
    const phase = i % period;
    phaseSums[phase]! += y[i]! - tr;
    phaseCounts[phase]! += 1;
  }
  const rawSeasonalByPhase: number[] = phaseSums.map((s, idx) =>
    phaseCounts[idx]! === 0 ? 0 : s / phaseCounts[idx]!,
  );
  // Centre the seasonal component to mean zero so it does not
  // contaminate the trend.
  const seasonalMean =
    rawSeasonalByPhase.reduce((acc, v) => acc + v, 0) / period;
  const centredSeasonalByPhase = rawSeasonalByPhase.map(
    (v) => v - seasonalMean,
  );
  const seasonal: number[] = new Array(n)
    .fill(0)
    .map((_, i) => centredSeasonalByPhase[i % period]!);
  // Step 3: residual.
  const residual: Array<number | null> = trend.map((tr, i) => {
    if (tr === null) return null;
    return y[i]! - tr - seasonal[i]!;
  });
  return { trend, seasonal, residual, period };
}
