/**
 * Pure-TS naive baselines for the SOTA forecasting layer.
 *
 * Three baselines, each implementing `SotaForecastingPort`:
 *
 *  - naive-last     — repeat the last observed value across the
 *                     horizon. The robust low-information floor model.
 *  - naive-seasonal — repeat the last full seasonal cycle. Requires a
 *                     seasonality hint (12 for monthly, 7 for daily, …).
 *  - naive-mean     — predict the arithmetic mean of the training
 *                     window for every horizon step.
 *
 * All three produce simple symmetric residual-based prediction
 * intervals (80 % and 95 %) using the in-sample residual standard
 * deviation. This is the textbook "naive forecast interval" from
 * Hyndman & Athanasopoulos, Forecasting: Principles and Practice
 * (3rd ed.), section 5.5: the prediction interval is
 * `point ± z_α · σ_residual · sqrt(h)` for naive, and
 * `point ± z_α · σ_residual` for the mean baseline.
 *
 * The intervals are intentionally conservative — they are the *floor*
 * for the ensemble, never the headline.
 *
 * @module @borjie/forecasting/sota/models/naive-baseline
 */

import {
  forecastHorizonSchema,
  timeSeriesSchema,
  type ForecastHorizon,
  type ForecastOptions,
  type IntervalBound,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';

const MODEL_VERSION = 'naive-2026.05.27';

// z scores for 80 % (alpha=0.2) and 95 % (alpha=0.05) two-sided.
const Z_80 = 1.2815515655446004;
const Z_95 = 1.959963984540054;

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function values(series: TimeSeries): ReadonlyArray<number> {
  return series.points.map((p) => p.y);
}

function residualStdDev(residuals: ReadonlyArray<number>): number {
  if (residuals.length < 2) return 0;
  const n = residuals.length;
  const mean = residuals.reduce((acc, r) => acc + r, 0) / n;
  const sumSq = residuals.reduce((acc, r) => acc + (r - mean) ** 2, 0);
  return Math.sqrt(sumSq / (n - 1));
}

function advanceISO(t: string, frequency: TimeSeries['frequency']): string {
  const date = new Date(t);
  switch (frequency) {
    case 'hourly':
      date.setUTCHours(date.getUTCHours() + 1);
      break;
    case 'daily':
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case 'quarterly':
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case 'yearly':
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    default: {
      const exhaustive: never = frequency;
      throw new Error(`unsupported frequency: ${String(exhaustive)}`);
    }
  }
  return date.toISOString();
}

function buildIntervals(
  point: ReadonlyArray<number>,
  sigma: number,
  growth: 'sqrt-h' | 'flat',
): {
  intervals_80: ReadonlyArray<IntervalBound>;
  intervals_95: ReadonlyArray<IntervalBound>;
} {
  const i80: IntervalBound[] = [];
  const i95: IntervalBound[] = [];
  for (let h = 0; h < point.length; h += 1) {
    const yhat = point[h]!;
    const k = growth === 'sqrt-h' ? Math.sqrt(h + 1) : 1;
    const w80 = Z_80 * sigma * k;
    const w95 = Z_95 * sigma * k;
    i80.push({ step: h + 1, lower: yhat - w80, upper: yhat + w80 });
    i95.push({ step: h + 1, lower: yhat - w95, upper: yhat + w95 });
  }
  return { intervals_80: i80, intervals_95: i95 };
}

function emptyIntervals(point: ReadonlyArray<number>): {
  intervals_80: ReadonlyArray<IntervalBound>;
  intervals_95: ReadonlyArray<IntervalBound>;
} {
  const i80: IntervalBound[] = [];
  const i95: IntervalBound[] = [];
  for (let h = 0; h < point.length; h += 1) {
    const yhat = point[h]!;
    i80.push({ step: h + 1, lower: yhat, upper: yhat });
    i95.push({ step: h + 1, lower: yhat, upper: yhat });
  }
  return { intervals_80: i80, intervals_95: i95 };
}

// ─────────────────────────────────────────────────────────────────────
// naive-last
// ─────────────────────────────────────────────────────────────────────

export function createNaiveLastForecaster(): SotaForecastingPort {
  return {
    model: 'naive-last',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const series = timeSeriesSchema.parse(args.series) as TimeSeries;
      const horizon: ForecastHorizon = forecastHorizonSchema.parse(args.horizon);
      const y = values(series);
      if (y.length === 0) {
        throw new RangeError('naive-last: empty series');
      }
      const last = y[y.length - 1]!;
      const point = Array.from({ length: horizon.steps }, () => last);
      // Residuals = one-step diffs (naive in-sample residuals).
      const diffs: number[] = [];
      for (let i = 1; i < y.length; i += 1) {
        diffs.push(y[i]! - y[i - 1]!);
      }
      const sigma = residualStdDev(diffs);
      const intervals = sigma === 0 ? emptyIntervals(point) : buildIntervals(point, sigma, 'sqrt-h');
      return {
        seriesId: series.id,
        model: 'naive-last',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: intervals.intervals_80,
        intervals_95: intervals.intervals_95,
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// naive-seasonal
// ─────────────────────────────────────────────────────────────────────

export interface NaiveSeasonalOptions {
  readonly seasonality: number;
}

function defaultSeasonality(frequency: TimeSeries['frequency']): number {
  switch (frequency) {
    case 'hourly':
      return 24;
    case 'daily':
      return 7;
    case 'weekly':
      return 52;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'yearly':
      return 1;
    default: {
      const ex: never = frequency;
      throw new Error(`unsupported frequency: ${String(ex)}`);
    }
  }
}

export function createNaiveSeasonalForecaster(
  cfg?: NaiveSeasonalOptions,
): SotaForecastingPort {
  return {
    model: 'naive-seasonal',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const series = timeSeriesSchema.parse(args.series) as TimeSeries;
      const horizon: ForecastHorizon = forecastHorizonSchema.parse(args.horizon);
      const optsAny = args.opts as ForecastOptions | undefined;
      const period =
        cfg?.seasonality ??
        optsAny?.seasonality ??
        defaultSeasonality(series.frequency);
      const y = values(series);
      if (y.length === 0) {
        throw new RangeError('naive-seasonal: empty series');
      }
      if (period < 1) {
        throw new RangeError(
          `naive-seasonal: seasonality must be >= 1, got ${period}`,
        );
      }
      const point: number[] = [];
      for (let h = 0; h < horizon.steps; h += 1) {
        // Wrap around the last full period of the training set.
        const idx = y.length - period + (h % period);
        const safe = idx >= 0 ? idx : y.length - 1;
        point.push(y[safe]!);
      }
      // Seasonal residuals = y_t - y_{t - period}.
      const residuals: number[] = [];
      for (let i = period; i < y.length; i += 1) {
        residuals.push(y[i]! - y[i - period]!);
      }
      const sigma = residualStdDev(residuals);
      const intervals = sigma === 0 ? emptyIntervals(point) : buildIntervals(point, sigma, 'sqrt-h');
      return {
        seriesId: series.id,
        model: 'naive-seasonal',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: intervals.intervals_80,
        intervals_95: intervals.intervals_95,
        generatedAtISO: new Date().toISOString(),
        meta: { seasonality: period },
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// naive-mean
// ─────────────────────────────────────────────────────────────────────

export function createNaiveMeanForecaster(): SotaForecastingPort {
  return {
    model: 'naive-mean',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const series = timeSeriesSchema.parse(args.series) as TimeSeries;
      const horizon: ForecastHorizon = forecastHorizonSchema.parse(args.horizon);
      const y = values(series);
      if (y.length === 0) {
        throw new RangeError('naive-mean: empty series');
      }
      const mean = y.reduce((acc, v) => acc + v, 0) / y.length;
      const point = Array.from({ length: horizon.steps }, () => mean);
      const residuals = y.map((v) => v - mean);
      const sigma = residualStdDev(residuals);
      const intervals = sigma === 0 ? emptyIntervals(point) : buildIntervals(point, sigma, 'flat');
      return {
        seriesId: series.id,
        model: 'naive-mean',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: intervals.intervals_80,
        intervals_95: intervals.intervals_95,
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

// Helper used by the walk-forward harness, exported for the suite tests.
export function nextTimestamp(t: string, freq: TimeSeries['frequency']): string {
  return advanceISO(t, freq);
}
