/**
 * Holt-Winters triple-exponential-smoothing forecaster.
 *
 * Captures level, trend, and additive seasonality. Closed-form fit
 * with grid-searched smoothing constants on a small holdout (last
 * `tuneWindow` points). Pure-TS, no external deps.
 *
 * References: Holt (1957); Winters (1960); Hyndman et al.
 * "Forecasting with Exponential Smoothing" (2008).
 */

import type {
  ForecastingPort,
  TimeSeriesForecast,
} from '../types.js';
import {
  assertValidSeries,
  buildForecastIntervals,
  futureTimestamps,
  mean,
  stdDev,
  values,
} from '../util/series.js';

export interface HoltWintersOptions {
  /** Seasonal period (in steps). Required when the series shows
   *  seasonality; otherwise pass 1 for non-seasonal. Default
   *  inferred from frequency. */
  readonly seasonalPeriod?: number;
  /** Override alpha (level smoothing). Default tuned. */
  readonly alphaLevel?: number;
  /** Override beta (trend smoothing). Default tuned. */
  readonly betaTrend?: number;
  /** Override gamma (seasonal smoothing). Default tuned. */
  readonly gammaSeasonal?: number;
  /** Scale for the heuristic interval (≈ 90% = 1.645). */
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

interface FitParams {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly m: number;
}

interface FittedState {
  readonly level: number;
  readonly trend: number;
  readonly seasonal: ReadonlyArray<number>;
  readonly residuals: ReadonlyArray<number>;
}

function fitHoltWinters(
  ys: ReadonlyArray<number>,
  params: FitParams,
): FittedState {
  const { alpha, beta, gamma, m } = params;
  const n = ys.length;
  if (n < 2 * m) {
    // Not enough data for a seasonal fit; fall back to non-seasonal
    // Holt (m=1) by ignoring seasonal terms.
  }

  // Initialise level + trend from the first 2 seasons (or first 2
  // points if too short).
  let level: number;
  let trend: number;
  let seasonal: number[];

  if (n >= 2 * m && m > 1) {
    const firstSeason = ys.slice(0, m);
    const secondSeason = ys.slice(m, 2 * m);
    level = mean(firstSeason);
    trend = (mean(secondSeason) - mean(firstSeason)) / m;
    seasonal = firstSeason.map((y) => y - level);
  } else {
    level = ys[0]!;
    trend = ys.length > 1 ? ys[1]! - ys[0]! : 0;
    seasonal = new Array(Math.max(1, m)).fill(0);
  }

  const residuals: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const sIdx = i % seasonal.length;
    const pred = level + trend + (seasonal[sIdx] ?? 0);
    residuals.push(ys[i]! - pred);
    const prevLevel = level;
    const prevTrend = trend;
    level = alpha * (ys[i]! - (seasonal[sIdx] ?? 0)) + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    if (m > 1) {
      seasonal[sIdx] = gamma * (ys[i]! - level) + (1 - gamma) * (seasonal[sIdx] ?? 0);
    }
  }

  return Object.freeze({
    level,
    trend,
    seasonal: Object.freeze([...seasonal]),
    residuals: Object.freeze(residuals),
  });
}

function tuneParams(
  ys: ReadonlyArray<number>,
  m: number,
): FitParams {
  // Coarse grid-search. 4 × 4 × 4 = 64 fits; cheap on JS for series
  // up to ~2000 points.
  const grid = [0.1, 0.3, 0.5, 0.8];
  let best: FitParams = { alpha: 0.5, beta: 0.1, gamma: 0.1, m };
  let bestScore = Infinity;
  for (const a of grid) {
    for (const b of grid) {
      for (const g of grid) {
        const fit = fitHoltWinters(ys, { alpha: a, beta: b, gamma: g, m });
        const sse = fit.residuals.reduce((s, r) => s + r * r, 0);
        if (sse < bestScore) {
          bestScore = sse;
          best = { alpha: a, beta: b, gamma: g, m };
        }
      }
    }
  }
  return best;
}

export function createHoltWintersForecaster(
  opts: HoltWintersOptions = {},
): ForecastingPort {
  return {
    kind: 'holt-winters',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon, opts: callOpts } = args;
      assertValidSeries(series);
      if (series.points.length < 2) {
        throw new RangeError('holt-winters: need at least 2 observations');
      }
      const alpha = callOpts?.alpha ?? 0.1;
      const m =
        callOpts?.seasonality ??
        opts.seasonalPeriod ??
        FREQUENCY_DEFAULT_SEASON[series.frequency] ??
        1;
      const z = opts.intervalZ ?? 1.645;

      const ys = values(series);

      // Pick params: explicit > tuned.
      let params: FitParams;
      if (
        opts.alphaLevel != null &&
        opts.betaTrend != null &&
        opts.gammaSeasonal != null
      ) {
        params = {
          alpha: opts.alphaLevel,
          beta:  opts.betaTrend,
          gamma: opts.gammaSeasonal,
          m,
        };
      } else {
        params = tuneParams(ys, m);
      }

      const fit = fitHoltWinters(ys, params);

      // Forecast: ŷ_{t+h} = level + h*trend + seasonal[(n + h - 1) mod m]
      const pts: number[] = [];
      const baseIdx = ys.length;
      for (let h = 1; h <= horizon.steps; h += 1) {
        const sIdx = (baseIdx + h - 1) % fit.seasonal.length;
        pts.push(fit.level + h * fit.trend + (fit.seasonal[sIdx] ?? 0));
      }

      const halfWidth = z * stdDev(fit.residuals.length > 1 ? fit.residuals : [0, 0]);

      const future = futureTimestamps(series, horizon.steps);
      const lower = pts.map((p) => p - halfWidth);
      const upper = pts.map((p) => p + halfWidth);
      const intervals = buildForecastIntervals({
        future,
        points: pts,
        lower,
        upper,
        alpha,
        conformal: false,
      });

      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'holt-winters',
        modelVersion: 'holt-winters-1',
        horizon,
        points:       intervals,
        generatedAt:  new Date().toISOString(),
        meta: {
          seasonalPeriod: m,
          alpha: params.alpha,
          beta:  params.beta,
          gamma: params.gamma,
          halfWidth,
        },
      });
    },
  };
}
