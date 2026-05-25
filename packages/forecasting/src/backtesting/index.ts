/**
 * Walk-forward time-series cross-validation.
 *
 * For a series of length N, horizon h, and `splits` validation folds,
 * we construct fold k by training on points [0..end_k) and validating
 * on [end_k..end_k+h). The split ends are evenly spaced across the
 * trailing portion of the series so we always validate on the most
 * recent (most relevant) data.
 *
 * A `gap` (default 0) is inserted between train and test to model
 * the realistic case where features-at-prediction-time exclude the
 * last `gap` points (e.g. settlement lag).
 *
 * Metrics: MAE, MAPE, RMSE, MASE (Hyndman & Koehler 2006), and a
 * lightweight CRPS approximation built from the predictor's lower/
 * upper bounds.
 *
 * References:
 *  - Bergmeir & Benítez "On the use of cross-validation for time-series"
 *    (Information Sciences, 2012).
 *  - Hyndman & Koehler "Another look at measures of forecast accuracy"
 *    (Int. J. Forecasting, 2006).
 *  - Gneiting & Raftery "Strictly Proper Scoring Rules" (JASA, 2007).
 */

import type {
  BacktestMetricResult,
  BacktestResult,
  BacktestSplit,
  ForecastingPort,
  Horizon,
  TimeSeries,
} from '../types.js';
import { assertValidSeries, mean } from '../util/series.js';

export type BacktestMetric = BacktestMetricResult['metric'];

export interface BacktestOptions {
  /** Number of walk-forward splits. */
  readonly splits: number;
  /** Forecast horizon. */
  readonly horizon: Horizon;
  /** Set of metrics to compute. */
  readonly metrics: ReadonlyArray<BacktestMetric>;
  /** Minimum training-set size (in points). Default 10. */
  readonly minTrainSize?: number;
  /** Gap between train and validation. Default 0. */
  readonly gap?: number;
  /** Seasonal period used by MASE. Default 1. */
  readonly seasonalPeriodForMase?: number;
}

/** Pull a prefix of a series. */
function prefix(series: TimeSeries, n: number): TimeSeries {
  return {
    ...series,
    points: series.points.slice(0, n),
  };
}

function mae(residuals: ReadonlyArray<number>): number {
  if (residuals.length === 0) return NaN;
  return mean(residuals.map((r) => Math.abs(r)));
}

function rmse(residuals: ReadonlyArray<number>): number {
  if (residuals.length === 0) return NaN;
  return Math.sqrt(mean(residuals.map((r) => r * r)));
}

function mape(
  actuals: ReadonlyArray<number>,
  predictions: ReadonlyArray<number>,
): number {
  let acc = 0;
  let n = 0;
  for (let i = 0; i < actuals.length; i += 1) {
    const a = actuals[i]!;
    if (a === 0) continue;
    acc += Math.abs((a - predictions[i]!) / a);
    n += 1;
  }
  return n === 0 ? NaN : (acc / n) * 100;
}

function mase(args: {
  readonly residuals: ReadonlyArray<number>;
  readonly trainValues: ReadonlyArray<number>;
  readonly seasonalPeriod: number;
}): number {
  const { residuals, trainValues, seasonalPeriod } = args;
  if (residuals.length === 0 || trainValues.length <= seasonalPeriod) {
    return NaN;
  }
  let scale = 0;
  let count = 0;
  for (let i = seasonalPeriod; i < trainValues.length; i += 1) {
    scale += Math.abs(trainValues[i]! - trainValues[i - seasonalPeriod]!);
    count += 1;
  }
  if (count === 0 || scale === 0) return NaN;
  const denom = scale / count;
  return mae(residuals) / denom;
}

/** Approximate CRPS using the interval-score (Gneiting & Raftery 2007).
 *  For a single (lower, upper, point, actual) tuple:
 *    IS = (upper - lower)
 *         + (2/alpha) * (lower - actual) * I[actual < lower]
 *         + (2/alpha) * (actual - upper) * I[actual > upper]
 *  We average IS across all step×split observations. */
function intervalScore(args: {
  readonly actual: number;
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  readonly alpha: number;
}): number {
  void args.point;
  const { actual, lower, upper, alpha } = args;
  let score = upper - lower;
  if (actual < lower) score += (2 / alpha) * (lower - actual);
  if (actual > upper) score += (2 / alpha) * (actual - upper);
  return score;
}

export async function backtest(args: {
  readonly predictor: ForecastingPort;
  readonly series: TimeSeries;
  readonly opts: BacktestOptions;
}): Promise<BacktestResult> {
  const { predictor, series, opts } = args;
  assertValidSeries(series);
  const minTrain = opts.minTrainSize ?? 10;
  const gap = opts.gap ?? 0;
  const seasonalPeriodForMase = opts.seasonalPeriodForMase ?? 1;
  const h = opts.horizon.steps;
  const n = series.points.length;

  if (n < minTrain + gap + h) {
    throw new RangeError(
      `backtest: series length ${n} too short for minTrain=${minTrain}, gap=${gap}, horizon=${h}`,
    );
  }
  if (opts.splits < 1) {
    throw new RangeError('backtest: splits must be ≥ 1');
  }

  // Compute split endpoints so the last fold ends at n - h (so we have
  // h validation points) and folds are spaced evenly between
  // (minTrain + gap) and (n - h).
  const lastTrainEnd = n - h - gap;
  if (lastTrainEnd < minTrain) {
    throw new RangeError('backtest: cannot fit any fold under the constraints');
  }
  const totalRange = lastTrainEnd - minTrain;
  const splits: BacktestSplit[] = [];

  // For collecting overall metrics
  const allActuals: number[] = [];
  const allPreds:   number[] = [];
  const allResid:   number[] = [];
  const allTrainTail: number[] = []; // used by MASE
  const allISTerms: number[] = [];

  for (let k = 0; k < opts.splits; k += 1) {
    const trainEnd =
      opts.splits === 1
        ? lastTrainEnd
        : minTrain + Math.round((k * totalRange) / (opts.splits - 1));
    const testStart = trainEnd + gap;
    const testEnd = testStart + h;
    if (testEnd > n) break;

    const trainSeries = prefix(series, trainEnd);
    const fc = await predictor.predict({
      series: trainSeries,
      horizon: opts.horizon,
    });

    const splitResiduals: number[] = [];
    for (let step = 0; step < h; step += 1) {
      const actual = series.points[testStart + step]!.y;
      const interval = fc.points[step]!;
      const pred = interval.point;
      const resid = actual - pred;
      splitResiduals.push(resid);
      allActuals.push(actual);
      allPreds.push(pred);
      allResid.push(resid);
      if (opts.metrics.includes('crps')) {
        allISTerms.push(intervalScore({
          actual,
          point: interval.point,
          lower: interval.lower,
          upper: interval.upper,
          alpha: interval.alpha,
        }));
      }
    }

    // For MASE: include the train tail values so the scale can be
    // computed once at the end.
    if (k === opts.splits - 1) {
      for (const p of trainSeries.points) allTrainTail.push(p.y);
    }

    splits.push(Object.freeze({
      index: k,
      trainSize: trainEnd,
      testSize: h,
      residuals: Object.freeze(splitResiduals),
    }));
  }

  // Compute metrics
  const metrics: BacktestMetricResult[] = [];
  for (const m of opts.metrics) {
    let value: number;
    switch (m) {
      case 'mae':  value = mae(allResid); break;
      case 'rmse': value = rmse(allResid); break;
      case 'mape': value = mape(allActuals, allPreds); break;
      case 'mase':
        value = mase({
          residuals: allResid,
          trainValues: allTrainTail,
          seasonalPeriod: seasonalPeriodForMase,
        });
        break;
      case 'crps':
        value = allISTerms.length > 0 ? mean(allISTerms) : NaN;
        break;
      default: {
        const _exhaustive: never = m;
        void _exhaustive;
        value = NaN;
      }
    }
    metrics.push(Object.freeze({ metric: m, value }));
  }

  return Object.freeze({
    seriesId: series.id,
    modelKind: predictor.kind,
    splits: Object.freeze(splits),
    metrics: Object.freeze(metrics),
  });
}
