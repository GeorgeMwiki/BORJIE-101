/**
 * CashflowForecaster — Holt-Winters triple exponential smoothing.
 *
 * Additive seasonality with configurable period. Produces p10/p50/p90
 * bands from in-sample residual standard deviation. No external deps.
 *
 * Reference: Hyndman & Athanasopoulos, "Forecasting: Principles &
 * Practice", chapter 7.
 */

import type { TimePoint, ForecastBand, FittedModel } from '../../types.js';

export interface HoltWintersParams {
  readonly alpha: number; // level smoothing
  readonly beta: number; // trend smoothing
  readonly gamma: number; // seasonal smoothing
  readonly seasonLength: number;
  readonly level: number;
  readonly trend: number;
  readonly season: ReadonlyArray<number>;
  readonly lastT: number;
  readonly dtMs: number;
}

const DEFAULT_ALPHA = 0.4;
const DEFAULT_BETA = 0.1;
const DEFAULT_GAMMA = 0.2;

function inferDtMs(points: ReadonlyArray<TimePoint>): number {
  if (points.length < 2) return 24 * 60 * 60 * 1000; // 1 day
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i];
    const b = points[i - 1];
    if (a !== undefined && b !== undefined) diffs.push(a.t - b.t);
  }
  diffs.sort((a, b) => a - b);
  const mid = diffs[Math.floor(diffs.length / 2)];
  return mid ?? 24 * 60 * 60 * 1000;
}

export interface FitOptions {
  readonly alpha?: number;
  readonly beta?: number;
  readonly gamma?: number;
  readonly seasonLength?: number;
}

export function fitCashflow(
  history: ReadonlyArray<TimePoint>,
  opts: FitOptions = {},
): FittedModel<HoltWintersParams> {
  if (history.length < 4) {
    throw new Error('Need at least 4 historical points to fit Holt-Winters');
  }
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const beta = opts.beta ?? DEFAULT_BETA;
  const gamma = opts.gamma ?? DEFAULT_GAMMA;
  const seasonLength = Math.max(2, opts.seasonLength ?? 12);
  const values = history.map((p) => p.v);
  const dtMs = inferDtMs(history);

  // Seed: level = first value, trend = avg first-diff, season = 0
  let level = values[0] ?? 0;
  const firstWindow = Math.min(seasonLength, values.length - 1);
  let trend = 0;
  for (let i = 1; i <= firstWindow; i += 1) {
    const a = values[i];
    const b = values[i - 1];
    if (a !== undefined && b !== undefined) trend += a - b;
  }
  trend /= Math.max(1, firstWindow);
  const season: number[] = Array(seasonLength).fill(0);

  const residuals: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i] ?? 0;
    const sIdx = i % seasonLength;
    const prevLevel = level;
    const prevTrend = trend;
    const prevSeason = season[sIdx] ?? 0;
    const fitted = prevLevel + prevTrend + prevSeason;
    residuals.push(x - fitted);
    level = alpha * (x - prevSeason) + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    season[sIdx] = gamma * (x - level) + (1 - gamma) * prevSeason;
  }

  const residualStd = std(residuals);

  return {
    params: {
      alpha,
      beta,
      gamma,
      seasonLength,
      level,
      trend,
      season,
      lastT: history[history.length - 1]?.t ?? Date.now(),
      dtMs,
    },
    residualStd,
    sampleSize: history.length,
  };
}

export function forecastCashflow(
  model: FittedModel<HoltWintersParams>,
  horizonSteps: number,
): ReadonlyArray<ForecastBand> {
  const out: ForecastBand[] = [];
  const { level, trend, season, seasonLength, lastT, dtMs } = model.params;
  // 1.2816 ~ 80% interval (p10/p90) for normal residuals.
  const Z = 1.2816;
  for (let h = 1; h <= horizonSteps; h += 1) {
    const sIdx = (h - 1) % seasonLength;
    const p50 = level + h * trend + (season[sIdx] ?? 0);
    // Forecast-variance grows ~sqrt(h) under simple state-space.
    const sigma = model.residualStd * Math.sqrt(h);
    out.push({
      t: lastT + h * dtMs,
      p10: p50 - Z * sigma,
      p50,
      p90: p50 + Z * sigma,
    });
  }
  return out;
}

export function updateCashflow(
  model: FittedModel<HoltWintersParams>,
  actual: TimePoint,
): FittedModel<HoltWintersParams> {
  const { alpha, beta, gamma, seasonLength, level, trend, season } = model.params;
  // Step the model forward one observation.
  const idx = model.sampleSize % seasonLength;
  const prevSeason = season[idx] ?? 0;
  const newLevel = alpha * (actual.v - prevSeason) + (1 - alpha) * (level + trend);
  const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
  const nextSeason = [...season];
  nextSeason[idx] = gamma * (actual.v - newLevel) + (1 - gamma) * prevSeason;
  // Residual std: exponential running update.
  const fitted = level + trend + prevSeason;
  const residual = actual.v - fitted;
  const lambda = 0.1;
  const newStd = Math.sqrt(
    (1 - lambda) * model.residualStd * model.residualStd + lambda * residual * residual,
  );
  return {
    params: {
      ...model.params,
      level: newLevel,
      trend: newTrend,
      season: nextSeason,
      lastT: actual.t,
    },
    residualStd: newStd,
    sampleSize: model.sampleSize + 1,
  };
}

function std(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / xs.length;
  return Math.sqrt(v);
}
