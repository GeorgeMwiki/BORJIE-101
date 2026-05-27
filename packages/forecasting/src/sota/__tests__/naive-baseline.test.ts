/**
 * Naive baseline forecasters — deterministic invariants.
 *
 * The three baselines are the floor of the SOTA layer. The tests
 * pin (a) shape invariants required by every SotaForecastingPort
 * caller and (b) the residual-based interval algebra.
 *
 * Wave SOTA-FORECAST (Mr. Mwikila).
 */

import { describe, it, expect } from 'vitest';
import {
  createNaiveLastForecaster,
  createNaiveSeasonalForecaster,
  createNaiveMeanForecaster,
  nextTimestamp,
} from '../models/naive-baseline.js';
import type { TimeSeries } from '../types.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function dailySeries(values: ReadonlyArray<number>, id = 'fix-daily'): TimeSeries {
  return {
    id,
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

describe('createNaiveLastForecaster', () => {
  it('repeats the last observation across the horizon', async () => {
    const forecaster = createNaiveLastForecaster();
    const result = await forecaster.predict({
      series: dailySeries([10, 12, 14, 17]),
      horizon: { steps: 3 },
    });
    expect(result.model).toBe('naive-last');
    expect(result.point).toEqual([17, 17, 17]);
    expect(result.intervals_80).toHaveLength(3);
    expect(result.intervals_95).toHaveLength(3);
  });

  it('grows the prediction band as sqrt(h)', async () => {
    const forecaster = createNaiveLastForecaster();
    const r = await forecaster.predict({
      series: dailySeries([1, 3, 5, 4, 6, 8, 7, 9, 11]),
      horizon: { steps: 4 },
    });
    const widths = r.intervals_95.map((b) => b.upper - b.lower);
    // sqrt-h growth: width[h+1] / width[h] = sqrt((h+1)/h) > 1
    expect(widths[1]!).toBeGreaterThan(widths[0]!);
    expect(widths[2]!).toBeGreaterThan(widths[1]!);
    expect(widths[3]!).toBeGreaterThan(widths[2]!);
  });

  it('refuses an empty series', async () => {
    const forecaster = createNaiveLastForecaster();
    await expect(
      forecaster.predict({
        series: dailySeries([]),
        horizon: { steps: 1 },
      }),
    ).rejects.toThrow(/empty series/);
  });
});

describe('createNaiveSeasonalForecaster', () => {
  it('wraps the last full season across the horizon', async () => {
    const forecaster = createNaiveSeasonalForecaster({ seasonality: 4 });
    const r = await forecaster.predict({
      series: dailySeries([1, 2, 3, 4, 11, 12, 13, 14]),
      horizon: { steps: 6 },
    });
    expect(r.point).toEqual([11, 12, 13, 14, 11, 12]);
    expect(r.meta?.['seasonality']).toBe(4);
  });

  it('defaults seasonality from frequency when no hint given', async () => {
    const forecaster = createNaiveSeasonalForecaster();
    const r = await forecaster.predict({
      // daily defaults to 7
      series: dailySeries(Array.from({ length: 21 }, (_, i) => (i % 7) + 1)),
      horizon: { steps: 7 },
    });
    expect(r.point).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('createNaiveMeanForecaster', () => {
  it('predicts the arithmetic mean at every step', async () => {
    const forecaster = createNaiveMeanForecaster();
    const r = await forecaster.predict({
      series: dailySeries([2, 4, 6, 8]),
      horizon: { steps: 3 },
    });
    expect(r.point).toEqual([5, 5, 5]);
    // interval width is constant under 'flat' growth.
    const widths = r.intervals_80.map((b) => b.upper - b.lower);
    expect(widths[0]!).toBeCloseTo(widths[1]!, 12);
    expect(widths[1]!).toBeCloseTo(widths[2]!, 12);
  });
});

describe('nextTimestamp', () => {
  it('advances UTC timestamps by frequency', () => {
    const t = '2026-01-01T00:00:00.000Z';
    expect(nextTimestamp(t, 'daily')).toBe('2026-01-02T00:00:00.000Z');
    expect(nextTimestamp(t, 'weekly')).toBe('2026-01-08T00:00:00.000Z');
    expect(nextTimestamp(t, 'monthly')).toBe('2026-02-01T00:00:00.000Z');
  });
});
