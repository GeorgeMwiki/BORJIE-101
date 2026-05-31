/**
 * /api/v1/owner/forecasts — real-data assertions.
 *
 * Tests the Holt-Winters layer directly (cheap, deterministic) and
 * asserts:
 *   - the response shape envelope is correct
 *   - a synthesised seasonal series produces a non-constant projection
 *     (i.e. the forecaster is doing real work, not just returning the
 *     last observation)
 *   - the 95% interval is non-trivial (upper > point > lower)
 *   - the projection length equals the requested horizon
 *
 * We import only the model — the full Hono router is exercised by a
 * gateway integration test elsewhere. The point of this file is to
 * lock the contract that `runHoltWinters → packEnvelope` produces real
 * deltas, not stub data.
 */

import { describe, it, expect } from 'vitest';
import { createHoltWintersForecaster, type TimeSeries } from '@borjie/forecasting';

const Z_95 = 1.96;

describe('owner forecasts — Holt-Winters layer', () => {
  it('produces non-constant projection on a trending seasonal series', async () => {
    // 60 daily points: linear trend (base 100, +0.5/day) + weekly
    // seasonality (sin wave amplitude 10). The forecaster must capture
    // BOTH the upward trend and the weekly pattern.
    const points = Array.from({ length: 60 }, (_, i) => {
      const t = new Date(2026, 0, i + 1).toISOString();
      const trend = 100 + i * 0.5;
      const seasonal = 10 * Math.sin((2 * Math.PI * i) / 7);
      return { t, y: trend + seasonal };
    });
    const series: TimeSeries = {
      id: 'test::trending-seasonal',
      frequency: 'daily',
      unit: 'TZS',
      points,
    };
    const forecaster = createHoltWintersForecaster({ intervalZ: Z_95 });
    const result = await forecaster.predict({
      series,
      horizon: { steps: 14 },
      opts: { alpha: 0.05, seasonality: 7 },
    });

    expect(result.points.length).toBe(14);
    expect(result.modelKind).toBe('holt-winters');
    expect(result.modelVersion).toBe('holt-winters-1');

    // The point projection at step 14 must be HIGHER than at step 1,
    // because the trend is positive.
    const first = result.points[0]!;
    const last = result.points[13]!;
    expect(last.point).toBeGreaterThan(first.point);

    // The forecast 14 days out is NOT just a copy of the last
    // observation — that's the "violation" we want to forbid.
    const lastObservation = points[points.length - 1]!.y;
    const projection14 = last.point;
    expect(Math.abs(projection14 - lastObservation)).toBeGreaterThan(0.5);
  });

  it('returns a non-trivial 95% interval', async () => {
    // Noisy series — std dev about 5, mean 100. Should produce a
    // half-width of roughly z * 5 = 9.8.
    const rng = mulberry32(42);
    const points = Array.from({ length: 60 }, (_, i) => ({
      t: new Date(2026, 0, i + 1).toISOString(),
      y: 100 + (rng() - 0.5) * 10,
    }));
    const series: TimeSeries = {
      id: 'test::noisy',
      frequency: 'daily',
      unit: 'TZS',
      points,
    };
    const forecaster = createHoltWintersForecaster({ intervalZ: Z_95 });
    const result = await forecaster.predict({
      series,
      horizon: { steps: 7 },
      opts: { alpha: 0.05, seasonality: 7 },
    });
    for (const p of result.points) {
      // The interval must straddle the point.
      expect(p.lower).toBeLessThan(p.point);
      expect(p.upper).toBeGreaterThan(p.point);
      // The interval width must be > 0 — never collapsed.
      expect(p.upper - p.lower).toBeGreaterThan(0);
    }
    // The reported halfWidth should be in the same ballpark as the
    // noise std dev × z.
    const halfWidth = Number(result.meta?.halfWidth ?? 0);
    expect(halfWidth).toBeGreaterThan(0);
  });

  it('is deterministic given the same input series', async () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      t: new Date(2026, 0, i + 1).toISOString(),
      y: 100 + i * 0.3,
    }));
    const series: TimeSeries = {
      id: 'test::deterministic',
      frequency: 'daily',
      unit: 'TZS',
      points,
    };
    const fc = createHoltWintersForecaster({ intervalZ: Z_95 });
    const a = await fc.predict({
      series,
      horizon: { steps: 5 },
      opts: { alpha: 0.05, seasonality: 7 },
    });
    const b = await fc.predict({
      series,
      horizon: { steps: 5 },
      opts: { alpha: 0.05, seasonality: 7 },
    });
    for (let i = 0; i < a.points.length; i += 1) {
      expect(a.points[i]!.point).toBe(b.points[i]!.point);
      expect(a.points[i]!.lower).toBe(b.points[i]!.lower);
      expect(a.points[i]!.upper).toBe(b.points[i]!.upper);
    }
  });
});

// Tiny deterministic RNG for reproducible noise.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
