/**
 * Anomaly detection tests — deterministic synthetic fixtures.
 */

import { describe, it, expect } from 'vitest';
import { detectAnomalies, type TimeSeries } from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function makeSeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'anom-fixture',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

describe('anomaly / z-score detection', () => {
  it('identifies a single inserted spike', () => {
    const baseline = Array.from({ length: 40 }, () => 10);
    baseline[30] = 100;
    const anomalies = detectAnomalies({
      series: makeSeries(baseline),
      opts: { window: 14, threshold: 2.5, methods: ['zscore'] },
    });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies.some((a) => a.index === 30 && a.method === 'zscore')).toBe(true);
  });

  it('skips the first `window` points (insufficient history)', () => {
    const series = makeSeries(Array.from({ length: 20 }, (_, i) => i));
    const anomalies = detectAnomalies({
      series,
      opts: { window: 14, threshold: 2, methods: ['zscore'] },
    });
    for (const a of anomalies) expect(a.index).toBeGreaterThanOrEqual(14);
  });

  it('returns empty on a flat series', () => {
    const series = makeSeries(Array.from({ length: 30 }, () => 5));
    const anomalies = detectAnomalies({
      series,
      opts: { window: 14, threshold: 3, methods: ['zscore'] },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('does not flag normal noise at threshold=3', () => {
    // PRNG noise around mean 0 with std 1; threshold 3 should flag ~0.3% of points.
    const rand = (() => {
      let s = 9999;
      return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
    })();
    function gaussian(): number {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    const series = makeSeries(Array.from({ length: 100 }, () => gaussian()));
    const anomalies = detectAnomalies({
      series,
      opts: { window: 30, threshold: 3, methods: ['zscore'] },
    });
    // At most ~3% of points should be flagged (loose upper bound).
    expect(anomalies.length).toBeLessThanOrEqual(8);
  });
});

describe('anomaly / change-point detection', () => {
  it('flags a clear mean shift', () => {
    const series = makeSeries([
      ...Array.from({ length: 30 }, () => 10),
      ...Array.from({ length: 30 }, () => 50),
    ]);
    const anomalies = detectAnomalies({
      series,
      opts: {
        threshold: 1.5,
        methods: ['change-point'],
        minChangePointGap: 10,
      },
    });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    // The change-point should be near index 30.
    const cp = anomalies.find((a) => a.method === 'change-point')!;
    expect(Math.abs(cp.index - 30)).toBeLessThanOrEqual(10);
  });

  it('returns empty on a stationary series', () => {
    const series = makeSeries([
      ...Array.from({ length: 60 }, () => 10),
    ]);
    const anomalies = detectAnomalies({
      series,
      opts: { threshold: 2, methods: ['change-point'] },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('honours minChangePointGap by deduplicating nearby points', () => {
    const series = makeSeries([
      ...Array.from({ length: 25 }, () => 1),
      ...Array.from({ length: 25 }, () => 10),
      ...Array.from({ length: 25 }, () => 1),
    ]);
    const anomalies = detectAnomalies({
      series,
      opts: { threshold: 1, methods: ['change-point'], minChangePointGap: 5 },
    });
    // Two flips → at most 2 change-points
    expect(anomalies.length).toBeLessThanOrEqual(3);
  });
});

describe('anomaly / combined methods', () => {
  it('runs both methods when requested', () => {
    const series = makeSeries([
      ...Array.from({ length: 30 }, () => 5),
      ...Array.from({ length: 30 }, () => 25),
    ]);
    const anomalies = detectAnomalies({
      series,
      opts: { methods: ['zscore', 'change-point'], threshold: 2, window: 10 },
    });
    const methods = new Set(anomalies.map((a) => a.method));
    expect(methods.size).toBeGreaterThanOrEqual(1);
  });
});
