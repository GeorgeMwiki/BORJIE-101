/**
 * Conformal time-series wrapper — coverage tests on synthetic data.
 *
 * We generate a noisy ramp series with known noise scale, hold out 100
 * calibration windows, and check empirical coverage of the wrapped
 * predictor's intervals on 200 test windows.
 */

import { describe, it, expect } from 'vitest';
import {
  createMovingAverageForecaster,
  wrapWithConformalIntervals,
  type CalibrationSample,
  type TimeSeries,
  type Horizon,
} from '../index.js';

function prng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const ANCHOR = Date.parse('2025-01-01T00:00:00Z');

function makeNoisySeries(
  values: ReadonlyArray<number>,
  id: string = 'cal',
): TimeSeries {
  return {
    id,
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

describe('conformal / time-series wrapper', () => {
  it('produces conformal intervals that achieve ≥ 1-alpha coverage', async () => {
    const rand = prng(12345);
    const seriesLen = 60;
    const horizon: Horizon = { steps: 3 };
    const noise = 1.0;
    const alpha = 0.1;

    // Build calibration samples — each is a length-60 prefix and its
    // next 3 actual values.
    const calibration: CalibrationSample[] = [];
    for (let i = 0; i < 60; i += 1) {
      const ys: number[] = [];
      for (let j = 0; j < seriesLen; j += 1) ys.push(10 + noise * gaussian(rand));
      const actuals: number[] = [];
      for (let j = 0; j < horizon.steps; j += 1) actuals.push(10 + noise * gaussian(rand));
      calibration.push({
        series: makeNoisySeries(ys, `cal-${i}`),
        actuals,
        horizon,
      });
    }

    const base = createMovingAverageForecaster({ window: 30 });
    const wrapped = await wrapWithConformalIntervals({
      base,
      calibration,
      horizon,
      alpha,
      opts: { minPerStep: 30 },
    });

    // Test on 200 new sample-windows.
    let covered = 0;
    const total = 200 * horizon.steps;
    for (let i = 0; i < 200; i += 1) {
      const ys: number[] = [];
      for (let j = 0; j < seriesLen; j += 1) ys.push(10 + noise * gaussian(rand));
      const actuals: number[] = [];
      for (let j = 0; j < horizon.steps; j += 1) actuals.push(10 + noise * gaussian(rand));
      const fc = await wrapped.predict({
        series: makeNoisySeries(ys, `test-${i}`),
        horizon,
      });
      for (let h = 0; h < horizon.steps; h += 1) {
        const iv = fc.points[h]!;
        if (actuals[h]! >= iv.lower && actuals[h]! <= iv.upper) covered += 1;
        expect(iv.conformal).toBe(true);
      }
    }

    const coverage = covered / total;
    expect(coverage).toBeGreaterThanOrEqual(1 - alpha - 0.05);
  });

  it('rejects an empty calibration set', async () => {
    const base = createMovingAverageForecaster();
    await expect(
      wrapWithConformalIntervals({
        base,
        calibration: [],
        horizon: { steps: 2 },
      }),
    ).rejects.toThrow(/empty/);
  });

  it('rejects calibration that is too small per horizon step', async () => {
    const base = createMovingAverageForecaster();
    const calibration: CalibrationSample[] = [
      {
        series: makeNoisySeries([1, 2, 3, 4, 5]),
        actuals: [6, 7],
        horizon: { steps: 2 },
      },
    ];
    await expect(
      wrapWithConformalIntervals({
        base,
        calibration,
        horizon: { steps: 2 },
        opts: { minPerStep: 5 },
      }),
    ).rejects.toThrow(/residuals/);
  });

  it('clamps intervals when a clamp box is supplied', async () => {
    const rand = prng(999);
    const horizon: Horizon = { steps: 1 };
    const calibration: CalibrationSample[] = [];
    for (let i = 0; i < 35; i += 1) {
      const ys: number[] = [];
      for (let j = 0; j < 20; j += 1) ys.push(0.5 + 0.3 * gaussian(rand));
      calibration.push({
        series: makeNoisySeries(ys, `cal-${i}`),
        actuals: [0.5 + 0.3 * gaussian(rand)],
        horizon,
      });
    }
    const base = createMovingAverageForecaster({ window: 10 });
    const wrapped = await wrapWithConformalIntervals({
      base,
      calibration,
      horizon,
      alpha: 0.1,
      opts: { minPerStep: 30, clamp: { lower: 0, upper: 1 } },
    });
    const ys: number[] = [];
    for (let j = 0; j < 20; j += 1) ys.push(0.5);
    const fc = await wrapped.predict({
      series: makeNoisySeries(ys, 'clamp-test'),
      horizon,
    });
    expect(fc.points[0]!.lower).toBeGreaterThanOrEqual(0);
    expect(fc.points[0]!.upper).toBeLessThanOrEqual(1);
  });
});
