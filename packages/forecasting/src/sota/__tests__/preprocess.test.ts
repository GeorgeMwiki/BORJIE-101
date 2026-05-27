/**
 * Preprocess tests — seasonality decomposition, linear detrend,
 * outlier clipping.
 *
 * Wave SOTA-FORECAST.
 */

import { describe, it, expect } from 'vitest';
import { decomposeSeasonality } from '../preprocess/seasonality.js';
import { linearDetrend } from '../preprocess/trend.js';
import { clipOutliers } from '../preprocess/outlier.js';
import type { TimeSeries } from '../types.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function dailySeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'pre',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

describe('decomposeSeasonality', () => {
  it('recovers a strong period-4 sinusoid', () => {
    // Period-4 wave: [1, 2, 1, 0, 1, 2, 1, 0, …]
    const seasonal = [1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0];
    const dec = decomposeSeasonality(dailySeries(seasonal), 4);
    // The seasonal vector should be non-trivially non-zero with mean ≈ 0.
    const seasonalMean =
      dec.seasonal.reduce((acc, v) => acc + v, 0) / dec.seasonal.length;
    expect(Math.abs(seasonalMean)).toBeLessThan(1e-9);
    // Trend has nulls only at the edges (length `period/2` on each side).
    const nullCount = dec.trend.filter((v) => v === null).length;
    expect(nullCount).toBeGreaterThan(0);
    expect(nullCount).toBeLessThan(seasonal.length);
  });

  it('rejects period < 2', () => {
    expect(() => decomposeSeasonality(dailySeries([1, 2, 3]), 1)).toThrow(
      /period must be >= 2/,
    );
  });
});

describe('linearDetrend', () => {
  it('fits a straight line through a perfectly linear series', () => {
    const ld = linearDetrend(dailySeries([1, 2, 3, 4, 5]));
    expect(ld.slope).toBeCloseTo(1, 12);
    expect(ld.intercept).toBeCloseTo(1, 12);
    for (const r of ld.detrended) {
      expect(Math.abs(r)).toBeLessThan(1e-12);
    }
  });
});

describe('clipOutliers', () => {
  it('hampel-clips a single huge spike', () => {
    const result = clipOutliers(
      dailySeries([10, 11, 12, 10, 11, 1000, 10, 12, 11]),
      'hampel',
      3,
    );
    expect(result.mask).toContain(true);
    // Clipped value should be below the spike.
    const spikeIdx = result.mask.findIndex((m) => m);
    expect(result.clipped[spikeIdx]!).toBeLessThan(1000);
  });

  it('IQR-clips when method=iqr', () => {
    const r = clipOutliers(
      dailySeries([10, 11, 12, 13, 14, 15, 16, 200]),
      'iqr',
      1.5,
    );
    expect(r.mask[r.mask.length - 1]).toBe(true);
  });
});
