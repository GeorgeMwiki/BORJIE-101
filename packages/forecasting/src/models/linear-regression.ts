/**
 * Linear-regression forecaster.
 *
 * Fits ordinary-least-squares regression of y_t on:
 *   - t (linear time trend)
 *   - sin(2π·t/m), cos(2π·t/m) (Fourier seasonal pair, if m > 1)
 *
 * Closed-form solution via normal equations. Pure-TS; no matrix lib.
 * Robust for series of length 10 – 10000; numerically stable on
 * mean-centred features.
 */

import type {
  ForecastingPort,
  TimeSeriesForecast,
} from '../types.js';
import {
  assertValidSeries,
  buildForecastIntervals,
  futureTimestamps,
  stdDev,
  values,
} from '../util/series.js';

export interface LinearRegressionOptions {
  /** Add Fourier seasonal terms with period `seasonalPeriod`. */
  readonly seasonalPeriod?: number;
  /** Z-multiplier on residual std for the heuristic interval. */
  readonly intervalZ?: number;
}

const FREQUENCY_DEFAULT_SEASON: Readonly<Record<string, number>> = Object.freeze({
  hourly: 24,
  daily: 7,
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
});

/** Solve the 4×4 normal equations for design matrix
 *  [1, t, sin, cos] and target y. Returns [b0, b1, b2, b3].
 *  If seasonal=false we still return 4 coefficients but b2=b3=0. */
function olsFit(
  ys: ReadonlyArray<number>,
  m: number,
  seasonal: boolean,
): [number, number, number, number] {
  const n = ys.length;
  // Sums for X^T X
  let sx = 0, sxx = 0;
  let sSin = 0, sCos = 0;
  let sxSin = 0, sxCos = 0;
  let sSinSin = 0, sCosCos = 0, sSinCos = 0;
  let sy = 0, sxy = 0, sSiny = 0, sCosy = 0;

  for (let i = 0; i < n; i += 1) {
    const t = i;
    const angle = seasonal ? (2 * Math.PI * t) / m : 0;
    const si = seasonal ? Math.sin(angle) : 0;
    const co = seasonal ? Math.cos(angle) : 0;
    const y = ys[i]!;

    sx += t;
    sxx += t * t;
    sSin += si;
    sCos += co;
    sxSin += t * si;
    sxCos += t * co;
    sSinSin += si * si;
    sCosCos += co * co;
    sSinCos += si * co;

    sy += y;
    sxy += t * y;
    sSiny += si * y;
    sCosy += co * y;
  }

  // 4x4 matrix
  const A = [
    [n,    sx,     sSin,    sCos],
    [sx,   sxx,    sxSin,   sxCos],
    [sSin, sxSin,  sSinSin, sSinCos],
    [sCos, sxCos,  sSinCos, sCosCos],
  ];
  const b = [sy, sxy, sSiny, sCosy];

  // Solve via Gaussian elimination with partial pivoting (4x4).
  const m4 = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < 4; i += 1) {
    // pivot
    let maxRow = i;
    let maxAbs = Math.abs(m4[i]![i]!);
    for (let r = i + 1; r < 4; r += 1) {
      const abs = Math.abs(m4[r]![i]!);
      if (abs > maxAbs) {
        maxAbs = abs;
        maxRow = r;
      }
    }
    if (maxAbs < 1e-12) {
      // Singular (e.g. seasonal=false → sin/cos columns are all 0).
      // Zero-out the pivot row's coefficient and continue.
      m4[i]![i] = 1;
      m4[i]![4] = 0;
      continue;
    }
    if (maxRow !== i) {
      const tmp = m4[i]!;
      m4[i] = m4[maxRow]!;
      m4[maxRow] = tmp;
    }
    // eliminate
    for (let r = 0; r < 4; r += 1) {
      if (r === i) continue;
      const factor = m4[r]![i]! / m4[i]![i]!;
      for (let c = i; c < 5; c += 1) {
        m4[r]![c] = m4[r]![c]! - factor * m4[i]![c]!;
      }
    }
  }
  const coef: [number, number, number, number] = [
    m4[0]![4]! / m4[0]![0]!,
    m4[1]![4]! / m4[1]![1]!,
    m4[2]![4]! / m4[2]![2]!,
    m4[3]![4]! / m4[3]![3]!,
  ];
  return coef;
}

export function createLinearRegressionForecaster(
  opts: LinearRegressionOptions = {},
): ForecastingPort {
  return {
    kind: 'linear-regression',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon, opts: callOpts } = args;
      assertValidSeries(series);
      if (series.points.length < 2) {
        throw new RangeError('linear-regression: need at least 2 observations');
      }
      const alpha = callOpts?.alpha ?? 0.1;
      const m =
        callOpts?.seasonality ??
        opts.seasonalPeriod ??
        FREQUENCY_DEFAULT_SEASON[series.frequency] ??
        1;
      const z = opts.intervalZ ?? 1.645;
      const seasonal = m > 1 && series.points.length >= 2 * m;

      const ys = values(series);
      const [b0, b1, b2, b3] = olsFit(ys, m, seasonal);

      // In-sample residuals to size the interval.
      const inSample: number[] = [];
      const residuals: number[] = [];
      for (let i = 0; i < ys.length; i += 1) {
        const angle = seasonal ? (2 * Math.PI * i) / m : 0;
        const pred = b0 + b1 * i + b2 * Math.sin(angle) + b3 * Math.cos(angle);
        inSample.push(pred);
        residuals.push(ys[i]! - pred);
      }
      void inSample;

      const halfWidth = z * stdDev(residuals);

      // Forecast: predict for i = n, n+1, ..., n+steps-1
      const fc: number[] = [];
      const n = ys.length;
      for (let h = 1; h <= horizon.steps; h += 1) {
        const t = n + h - 1;
        const angle = seasonal ? (2 * Math.PI * t) / m : 0;
        fc.push(b0 + b1 * t + b2 * Math.sin(angle) + b3 * Math.cos(angle));
      }

      const future = futureTimestamps(series, horizon.steps);
      const lower = fc.map((p) => p - halfWidth);
      const upper = fc.map((p) => p + halfWidth);
      const intervals = buildForecastIntervals({
        future,
        points: fc,
        lower,
        upper,
        alpha,
        conformal: false,
      });

      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'linear-regression',
        modelVersion: 'linear-regression-1',
        horizon,
        points:       intervals,
        generatedAt:  new Date().toISOString(),
        meta: {
          intercept: b0,
          slope:     b1,
          seasonalSin: b2,
          seasonalCos: b3,
          seasonalPeriod: m,
          halfWidth,
        },
      });
    },
  };
}
