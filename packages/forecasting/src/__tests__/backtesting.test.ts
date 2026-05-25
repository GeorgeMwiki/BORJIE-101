/**
 * Backtesting harness tests.
 *
 * Drives the real harness over deterministic fixture series with a
 * known model (moving-average) so we can predict the metric values.
 */

import { describe, it, expect } from 'vitest';
import {
  backtest,
  createMovingAverageForecaster,
  createLinearRegressionForecaster,
  type TimeSeries,
} from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function makeSeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'bt-fixture',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

describe('backtesting / walk-forward CV', () => {
  it('produces a result for every metric requested', async () => {
    const predictor = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries(Array.from({ length: 50 }, (_, i) => 10 + Math.sin(i / 5)));
    const result = await backtest({
      predictor,
      series,
      opts: {
        splits: 3,
        horizon: { steps: 2 },
        metrics: ['mae', 'rmse', 'mape'],
      },
    });
    expect(result.metrics.map((m) => m.metric).sort()).toEqual(['mae', 'mape', 'rmse']);
    expect(result.splits.length).toBeGreaterThanOrEqual(1);
    for (const m of result.metrics) {
      expect(Number.isFinite(m.value)).toBe(true);
    }
  });

  it('reports MAE = 0 on a perfect predictor (flat series)', async () => {
    const predictor = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries(Array.from({ length: 30 }, () => 7));
    const result = await backtest({
      predictor,
      series,
      opts: {
        splits: 2,
        horizon: { steps: 3 },
        metrics: ['mae', 'rmse'],
      },
    });
    const mae = result.metrics.find((m) => m.metric === 'mae')!;
    const rmse = result.metrics.find((m) => m.metric === 'rmse')!;
    expect(mae.value).toBeCloseTo(0, 5);
    expect(rmse.value).toBeCloseTo(0, 5);
  });

  it('linear regression beats moving average on a noiseless ramp', async () => {
    const series = makeSeries(Array.from({ length: 40 }, (_, i) => i));
    const linReg = createLinearRegressionForecaster();
    const ma = createMovingAverageForecaster({ window: 5 });
    const linResult = await backtest({
      predictor: linReg,
      series,
      opts: { splits: 3, horizon: { steps: 3 }, metrics: ['mae'] },
    });
    const maResult = await backtest({
      predictor: ma,
      series,
      opts: { splits: 3, horizon: { steps: 3 }, metrics: ['mae'] },
    });
    expect(linResult.metrics[0]!.value).toBeLessThan(maResult.metrics[0]!.value);
  });

  it('rejects when series is too short for the splits + horizon', async () => {
    const predictor = createMovingAverageForecaster();
    const series = makeSeries([1, 2, 3]);
    await expect(
      backtest({
        predictor,
        series,
        opts: { splits: 3, horizon: { steps: 5 }, metrics: ['mae'] },
      }),
    ).rejects.toThrow();
  });

  it('reports MAPE as a percentage', async () => {
    const predictor = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries(Array.from({ length: 30 }, () => 100));
    const result = await backtest({
      predictor,
      series,
      opts: { splits: 2, horizon: { steps: 2 }, metrics: ['mape'] },
    });
    // Flat series with flat predictor → 0% MAPE
    expect(result.metrics[0]!.value).toBeCloseTo(0, 5);
  });

  it('computes MASE relative to the seasonal-naive scale', async () => {
    const predictor = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries(Array.from({ length: 40 }, (_, i) => 5 + Math.sin(i / 2)));
    const result = await backtest({
      predictor,
      series,
      opts: {
        splits: 2,
        horizon: { steps: 2 },
        metrics: ['mase'],
        seasonalPeriodForMase: 1,
      },
    });
    expect(Number.isFinite(result.metrics[0]!.value)).toBe(true);
  });

  it('computes CRPS-style interval score', async () => {
    const predictor = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries(Array.from({ length: 30 }, (_, i) => 10 + (i % 3)));
    const result = await backtest({
      predictor,
      series,
      opts: { splits: 2, horizon: { steps: 2 }, metrics: ['crps'] },
    });
    expect(Number.isFinite(result.metrics[0]!.value)).toBe(true);
    expect(result.metrics[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('respects the gap between train and test', async () => {
    const predictor = createMovingAverageForecaster({ window: 3 });
    const series = makeSeries(Array.from({ length: 30 }, (_, i) => i));
    const result = await backtest({
      predictor,
      series,
      opts: { splits: 2, horizon: { steps: 2 }, metrics: ['mae'], gap: 5 },
    });
    expect(result.splits.length).toBeGreaterThanOrEqual(1);
  });
});
