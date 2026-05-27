/**
 * Walk-forward backtest harness.
 *
 * Rolls a fixed-size training window forward, calling the model
 * once per split. The invariant is that at split `i`, only points
 * `[0, initialTrainSize + i * stepSize)` may be visible to the
 * model — strictly no look-ahead. The harness passes the model a
 * sliced `TimeSeries` so any model that respects its inputs is
 * automatically safe.
 *
 * Reference: Hyndman & Athanasopoulos, Forecasting: Principles and
 * Practice (3rd ed.), section 5.10 ("Time-series cross-validation").
 *
 * @module @borjie/forecasting/sota/backtest/walk-forward
 */

import { mae, rmse, smape, mase } from './metrics.js';
import type {
  Backtest,
  BacktestMetrics,
  BacktestSplit,
  ForecastHorizon,
  ForecastResult,
  SotaForecastingPort,
  TimeSeries,
} from '../types.js';

export interface WalkForwardOptions {
  readonly series: TimeSeries;
  readonly model: SotaForecastingPort;
  readonly horizon: ForecastHorizon;
  readonly initialTrainSize: number;
  readonly stepSize: number;
  readonly maxSplits?: number;
  /** Seasonal period for MASE — default 1 (non-seasonal). */
  readonly seasonalPeriod?: number;
}

export async function walkForwardBacktest(
  options: WalkForwardOptions,
): Promise<Backtest> {
  const { series, model, horizon } = options;
  const initialTrainSize = options.initialTrainSize;
  const stepSize = Math.max(1, options.stepSize);
  const maxSplits = options.maxSplits ?? 50;
  const seasonalPeriod = options.seasonalPeriod ?? 1;
  if (initialTrainSize < 2) {
    throw new RangeError('walkForwardBacktest: initialTrainSize must be >= 2');
  }
  if (series.points.length < initialTrainSize + horizon.steps) {
    throw new RangeError(
      `walkForwardBacktest: series too short — need >= ${
        initialTrainSize + horizon.steps
      } points, got ${series.points.length}`,
    );
  }
  const splits: BacktestSplit[] = [];
  const allErrors: number[] = [];
  const allY: number[] = [];
  const allYhat: number[] = [];
  let splitIndex = 0;
  let trainEnd = initialTrainSize;
  while (trainEnd + horizon.steps <= series.points.length) {
    if (splitIndex >= maxSplits) break;
    const trainPoints = series.points.slice(0, trainEnd);
    const testPoints = series.points.slice(trainEnd, trainEnd + horizon.steps);
    const trainSeries: TimeSeries = {
      ...series,
      points: trainPoints,
    };
    const result: ForecastResult = await model.predict({
      series: trainSeries,
      horizon,
    });
    if (result.point.length !== horizon.steps) {
      throw new Error(
        `walkForwardBacktest: model ${model.model} returned ${result.point.length} points, expected ${horizon.steps}`,
      );
    }
    const residuals: number[] = [];
    for (let i = 0; i < horizon.steps; i += 1) {
      const y = testPoints[i]!.y;
      const yhat = result.point[i]!;
      const e = y - yhat;
      residuals.push(e);
      allErrors.push(e);
      allY.push(y);
      allYhat.push(yhat);
    }
    splits.push({
      index: splitIndex,
      trainSize: trainPoints.length,
      testSize: horizon.steps,
      residuals,
    });
    splitIndex += 1;
    trainEnd += stepSize;
  }
  const overallY = Object.freeze(allY);
  const overallYhat = Object.freeze(allYhat);
  const trainY = series.points.slice(0, initialTrainSize).map((p) => p.y);
  const computedMase =
    trainY.length > seasonalPeriod
      ? mase({
          y: overallY,
          yhat: overallYhat,
          trainY,
          seasonalPeriod,
        })
      : undefined;
  const metrics: BacktestMetrics = {
    mae: mae({ y: overallY, yhat: overallYhat }),
    rmse: rmse({ y: overallY, yhat: overallYhat }),
    smape: smape({ y: overallY, yhat: overallYhat }),
    ...(computedMase !== undefined ? { mase: computedMase } : {}),
  };
  return {
    seriesId: series.id,
    model: model.model,
    splits,
    metrics,
  };
}
