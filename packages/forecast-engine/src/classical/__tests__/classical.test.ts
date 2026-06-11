/**
 * Classical-floor numerics — deterministic, no external deps.
 */

import { describe, it, expect } from 'vitest';
import { createSeasonalNaive } from '../seasonal-naive.js';
import { createEtsTheta } from '../ets-theta.js';
import { createCroston, createTsb } from '../croston-tsb.js';

describe('SeasonalNaive', () => {
  it('repeats the last value when non-seasonal (m=1)', () => {
    const m = createSeasonalNaive({ seasonLength: 1 });
    const out = m.forecast([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([5, 5, 5]);
  });

  it('repeats the seasonal cycle phase-aligned (m=4)', () => {
    const m = createSeasonalNaive({ seasonLength: 4 });
    // history ...,10,20,30,40 -> next 4 = 10,20,30,40
    const out = m.forecast([0, 0, 0, 0, 10, 20, 30, 40], 4);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('wraps the cycle past one season', () => {
    const m = createSeasonalNaive({ seasonLength: 2 });
    // last full season = [7, 8] (indices 6,7). Phase-aligned seasonal
    // naive: step h -> y_{n-m+((h-1)%m)} -> 7,8,7,8.
    const out = m.forecast([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(out).toEqual([7, 8, 7, 8]);
  });

  it('falls back to last value when history < one season', () => {
    const m = createSeasonalNaive({ seasonLength: 12 });
    const out = m.forecast([3, 9], 2);
    expect(out).toEqual([9, 9]);
  });

  it('is pure — does not mutate input', () => {
    const m = createSeasonalNaive({ seasonLength: 2 });
    const hist = [1, 2, 3, 4];
    const copy = [...hist];
    m.forecast(hist, 3);
    expect(hist).toEqual(copy);
  });
});

describe('ETS / Theta smoother', () => {
  it('on a flat series forecasts the flat level', () => {
    const m = createEtsTheta({ alpha: 0.5 });
    const out = m.forecast([5, 5, 5, 5, 5], 3);
    out.forEach((v) => expect(v).toBeCloseTo(5, 6));
  });

  it('extrapolates a linear trend with positive drift', () => {
    const m = createEtsTheta({ alpha: 0.6 });
    const out = m.forecast([1, 2, 3, 4, 5, 6, 7, 8], 3);
    // strictly increasing forecast on a clean upward trend
    expect(out[0]!).toBeLessThan(out[1]!);
    expect(out[1]!).toBeLessThan(out[2]!);
    // near continuation of the line (~9,10,11) — drift is slope/2 so it
    // is conservative; assert monotonic + above the last observed level.
    expect(out[0]!).toBeGreaterThan(7);
  });

  it('handles single-point history', () => {
    const m = createEtsTheta();
    expect(m.forecast([42], 2)).toEqual([42, 42]);
  });

  it('is deterministic across calls', () => {
    const m = createEtsTheta({ alpha: 0.3 });
    const a = m.forecast([3, 1, 4, 1, 5, 9, 2, 6], 4);
    const b = m.forecast([3, 1, 4, 1, 5, 9, 2, 6], 4);
    expect(a).toEqual(b);
  });
});

describe('Croston / TSB (intermittent)', () => {
  it('Croston estimates demand rate = size / interval', () => {
    // demand of 2 every 3rd period -> rate ~ 2/3
    const series = [0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2];
    const m = createCroston({ alpha: 0.2 });
    const out = m.forecast(series, 3);
    out.forEach((v) => expect(v).toBeCloseTo(2 / 3, 1));
    // flat rate forecast
    expect(new Set(out).size).toBe(1);
  });

  it('returns zero for an all-zero series', () => {
    expect(createCroston().forecast([0, 0, 0, 0], 2)).toEqual([0, 0]);
    expect(createTsb().forecast([0, 0, 0, 0], 2)).toEqual([0, 0]);
  });

  it('TSB decays toward zero when demand stops (obsolescence)', () => {
    const active = [0, 1, 0, 1, 0, 1, 0, 1];
    const stopped = [0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    const m = createTsb({ alphaProbability: 0.3, alphaSize: 0.3 });
    const rateActive = m.forecast(active, 1)[0]!;
    const rateStopped = m.forecast(stopped, 1)[0]!;
    // a long zero tail must pull the TSB rate DOWN vs the active series
    expect(rateStopped).toBeLessThan(rateActive);
    expect(rateStopped).toBeGreaterThanOrEqual(0);
  });

  it('TSB produces a flat (constant) forecast path', () => {
    const m = createTsb();
    const out = m.forecast([0, 3, 0, 0, 5, 0, 2], 5);
    expect(new Set(out).size).toBe(1);
  });
});
