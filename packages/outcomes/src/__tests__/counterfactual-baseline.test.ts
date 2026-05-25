/**
 * Counterfactual baseline math — deterministic over its inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  computeBaseline,
  deltaAboveBaseline,
} from '../counterfactual-baseline.js';
import type { BaselineMonthSample } from '../types.js';

function months(
  values: ReadonlyArray<number>,
  start = '2025-06',
): ReadonlyArray<BaselineMonthSample> {
  // build a contiguous YYYY-MM sequence starting at `start`.
  const [ys, ms] = start.split('-').map((s) => Number.parseInt(s, 10));
  return values.map((v, i) => {
    const y = (ys as number) + Math.floor(((ms as number) - 1 + i) / 12);
    const m = (((ms as number) - 1 + i) % 12) + 1;
    return {
      month: `${y}-${String(m).padStart(2, '0')}`,
      collectedMinor: v,
    };
  });
}

describe('computeBaseline', () => {
  it('produces a trustworthy baseline with 12 months of data', () => {
    const sample = months(Array(12).fill(1_000_000));
    const b = computeBaseline('prop-1', sample);
    expect(b.months).toBe(12);
    expect(b.meanMonthlyCollectedMinor).toBe(1_000_000);
    expect(b.stddevMonthlyCollectedMinor).toBe(0);
    expect(b.trustworthy).toBe(true);
    expect(b.propertyId).toBe('prop-1');
  });

  it('marks short samples untrustworthy and reports actual months', () => {
    const sample = months([800_000, 1_200_000, 1_100_000]); // 3 months
    const b = computeBaseline('prop-2', sample);
    expect(b.months).toBe(3);
    expect(b.trustworthy).toBe(false);
    // mean of [800k, 1.2M, 1.1M] = 1,033,333 → floor → 1,033,333.
    expect(b.meanMonthlyCollectedMinor).toBe(1_033_333);
  });

  it('takes only the trailing window when more data is supplied', () => {
    // 20 months: first 8 = 0, last 12 = 1,000,000 each.
    const sample = months([...Array(8).fill(0), ...Array(12).fill(1_000_000)]);
    const b = computeBaseline('prop-3', sample);
    expect(b.months).toBe(12);
    expect(b.meanMonthlyCollectedMinor).toBe(1_000_000);
  });

  it('honours custom minMonths / windowMonths', () => {
    const sample = months([100, 200, 300, 400, 500, 600]);
    const b = computeBaseline('prop-4', sample, {
      minMonths: 3,
      windowMonths: 4,
    });
    // tail-4 of [100,200,300,400,500,600] = [300,400,500,600] → mean 450.
    expect(b.months).toBe(4);
    expect(b.meanMonthlyCollectedMinor).toBe(450);
    expect(b.trustworthy).toBe(true);
  });

  it('returns zero baseline on empty samples', () => {
    const b = computeBaseline('prop-5', []);
    expect(b.months).toBe(0);
    expect(b.meanMonthlyCollectedMinor).toBe(0);
    expect(b.stddevMonthlyCollectedMinor).toBe(0);
    expect(b.trustworthy).toBe(false);
  });

  it('throws on duplicate months', () => {
    expect(() =>
      computeBaseline('p', [
        { month: '2025-06', collectedMinor: 1 },
        { month: '2025-06', collectedMinor: 2 },
      ]),
    ).toThrow(/duplicate month/);
  });

  it('throws on negative collection amounts', () => {
    expect(() =>
      computeBaseline('p', [{ month: '2025-06', collectedMinor: -1 }]),
    ).toThrow(/negative/);
  });

  it('throws on missing propertyId', () => {
    expect(() => computeBaseline('', months([1]))).toThrow(/propertyId/);
  });

  it('throws on non-positive minMonths or windowMonths', () => {
    expect(() => computeBaseline('p', months([1]), { minMonths: 0 })).toThrow();
    expect(() =>
      computeBaseline('p', months([1]), { windowMonths: 0 }),
    ).toThrow();
  });

  it('computes correct population stddev on uneven data', () => {
    // values [10, 20, 30, 40, 50] → mean 30, popvar = 200, popstd ≈ 14.14
    const sample = months([10, 20, 30, 40, 50]);
    const b = computeBaseline('p', sample, { minMonths: 5, windowMonths: 5 });
    expect(b.meanMonthlyCollectedMinor).toBe(30);
    expect(b.stddevMonthlyCollectedMinor).toBe(14); // floor(14.142)
  });
});

describe('deltaAboveBaseline', () => {
  it('returns the positive delta on a trustworthy baseline', () => {
    const b = computeBaseline('p', months(Array(12).fill(1_000_000)));
    expect(deltaAboveBaseline(1_200_000, b)).toBe(200_000);
  });

  it('clamps negative deltas to 0', () => {
    const b = computeBaseline('p', months(Array(12).fill(1_000_000)));
    expect(deltaAboveBaseline(800_000, b)).toBe(0);
  });

  it('clamps to 0 on a zero/negative actual collection', () => {
    const b = computeBaseline('p', months(Array(12).fill(1_000_000)));
    expect(deltaAboveBaseline(0, b)).toBe(0);
    expect(deltaAboveBaseline(-100, b)).toBe(0);
  });

  it('returns 0 when the baseline is untrustworthy (fall back to floor)', () => {
    const b = computeBaseline('p', months([1_000_000])); // only 1 month
    expect(b.trustworthy).toBe(false);
    expect(deltaAboveBaseline(5_000_000, b)).toBe(0);
  });

  it('zero delta returns zero (boundary)', () => {
    const b = computeBaseline('p', months(Array(12).fill(1_000_000)));
    expect(deltaAboveBaseline(1_000_000, b)).toBe(0);
  });
});
