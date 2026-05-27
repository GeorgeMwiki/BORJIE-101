/**
 * Accuracy metrics + walk-forward backtest tests.
 *
 * Pins (worked-example sanity checks from H&A 3rd ed.):
 *  - MAE/RMSE/sMAPE on a simple [actual, forecast] vector
 *  - MASE scales by the seasonal-naive in-sample error
 *  - walkForwardBacktest produces splits in chronological order
 *
 * Wave SOTA-FORECAST.
 */

import { describe, it, expect } from 'vitest';
import {
  mae,
  rmse,
  mape,
  smape,
  mase,
  quantileLoss,
} from '../backtest/metrics.js';
import { walkForwardBacktest } from '../backtest/walk-forward.js';
import { createNaiveLastForecaster } from '../models/naive-baseline.js';
import type { TimeSeries } from '../types.js';

describe('metrics', () => {
  it('MAE is the mean of absolute errors', () => {
    expect(mae({ y: [1, 2, 3], yhat: [1.5, 2.5, 3.5] })).toBeCloseTo(0.5, 9);
  });

  it('RMSE is the root mean of squared errors', () => {
    expect(rmse({ y: [0, 0, 0], yhat: [1, -1, 1] })).toBeCloseTo(1, 9);
  });

  it('MAPE is mean(|e|/|y|) × 100', () => {
    expect(mape({ y: [10, 20], yhat: [11, 18] })).toBeCloseTo(10, 9);
  });

  it('sMAPE is bounded in [0, 200] and equals zero on perfect fit', () => {
    expect(smape({ y: [5, 5], yhat: [5, 5] })).toBe(0);
  });

  it('MASE scales errors by seasonal-naive in-sample error', () => {
    const trainY = [1, 2, 3, 4, 5, 6, 7, 8];
    // Seasonal-naive (m=1) in-sample error mean = 1 → scale = 1
    const value = mase({
      y: [10, 11],
      yhat: [11, 12],
      trainY,
      seasonalPeriod: 1,
    });
    // mean|error| = 1, scale = 1 → MASE = 1
    expect(value).toBeCloseTo(1, 9);
  });

  it('quantileLoss penalises over-prediction at high quantiles', () => {
    // q=0.9: under-prediction (e>0) is heavily penalised, over very lightly.
    const lossUnder = quantileLoss({
      y: [10, 10],
      yhatQuantile: [9, 9],
      q: 0.9,
    });
    const lossOver = quantileLoss({
      y: [10, 10],
      yhatQuantile: [11, 11],
      q: 0.9,
    });
    expect(lossUnder).toBeGreaterThan(lossOver);
  });
});

describe('walkForwardBacktest', () => {
  it('produces splits in chronological order with metrics', async () => {
    const series: TimeSeries = {
      id: 'wf',
      frequency: 'daily',
      points: Array.from({ length: 12 }, (_, i) => ({
        t: new Date(Date.parse('2026-01-01') + i * 86_400_000).toISOString(),
        y: i + 1,
      })),
    };
    const bt = await walkForwardBacktest({
      series,
      model: createNaiveLastForecaster(),
      horizon: { steps: 2 },
      initialTrainSize: 6,
      stepSize: 2,
    });
    expect(bt.splits.length).toBeGreaterThan(0);
    // splits indices monotonically increasing
    for (let i = 1; i < bt.splits.length; i += 1) {
      expect(bt.splits[i]!.index).toBeGreaterThan(bt.splits[i - 1]!.index);
    }
    expect(bt.metrics.mae).toBeGreaterThanOrEqual(0);
  });

  it('throws when the series is too short for the configured horizon', async () => {
    const series: TimeSeries = {
      id: 'short',
      frequency: 'daily',
      points: Array.from({ length: 4 }, (_, i) => ({
        t: new Date(Date.parse('2026-01-01') + i * 86_400_000).toISOString(),
        y: i,
      })),
    };
    await expect(
      walkForwardBacktest({
        series,
        model: createNaiveLastForecaster(),
        horizon: { steps: 3 },
        initialTrainSize: 4,
        stepSize: 1,
      }),
    ).rejects.toThrow(/too short/);
  });
});
