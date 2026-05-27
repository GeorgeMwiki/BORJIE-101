/**
 * Descriptive statistics — reference-vector validation.
 *
 * Targets: mean, median, quantile, variance, stddev, skewness,
 * kurtosis, iqr, mode, histogram, describe.
 *
 * Tolerances: 6 decimal places where the reference is exact; 4 where
 * the textbook reference is itself rounded.
 */

import { describe as suite, it, expect } from 'vitest';
import { mean } from '../descriptive/mean.js';
import { median } from '../descriptive/median.js';
import { quantile } from '../descriptive/quantile.js';
import { variance } from '../descriptive/variance.js';
import { stddev } from '../descriptive/stddev.js';
import { skewness } from '../descriptive/skewness.js';
import { kurtosis } from '../descriptive/kurtosis.js';
import { iqr } from '../descriptive/iqr.js';
import { mode } from '../descriptive/mode.js';
import { histogram } from '../descriptive/histogram.js';
import { describe as describeStats } from '../descriptive/summary.js';

suite('descriptive primitives — reference vectors', () => {
  it('mean of [1, 2, 3, 4, 5] = 3 exactly', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('mean does not mutate the input array', () => {
    const input = [3, 1, 4, 1, 5, 9, 2, 6];
    const copy = [...input];
    mean(input);
    expect(input).toEqual(copy);
  });

  it('median of [1, 3, 3, 6, 7, 8, 9] = 6 (odd n)', () => {
    expect(median([1, 3, 3, 6, 7, 8, 9])).toBe(6);
  });

  it('median of [1, 2, 3, 4] = 2.5 (even n)', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('sample variance of [2,4,4,4,5,5,7,9] = 32/7 (n-1 denom)', () => {
    // Mean = 5, sum of squared deviations = 32, divide by n-1 = 7.
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(32 / 7, 12);
  });

  it('sample stddev of [2,4,4,4,5,5,7,9] = sqrt(32/7)', () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it('population variance of [2,4,4,4,5,5,7,9] = 4 (n denom, sum-sq-dev=32)', () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9], true)).toBeCloseTo(4, 12);
  });

  it('quantile type-7 on [15,20,35,40,50] matches R defaults', () => {
    // R: quantile(c(15,20,35,40,50), c(0, 0.25, 0.5, 0.75, 1)) →
    //   15 20 35 40 50
    expect(quantile([15, 20, 35, 40, 50], 0)).toBe(15);
    expect(quantile([15, 20, 35, 40, 50], 0.25)).toBeCloseTo(20, 12);
    expect(quantile([15, 20, 35, 40, 50], 0.5)).toBe(35);
    expect(quantile([15, 20, 35, 40, 50], 0.75)).toBeCloseTo(40, 12);
    expect(quantile([15, 20, 35, 40, 50], 1)).toBe(50);
  });

  it('IQR is Q3 − Q1', () => {
    const v = [15, 20, 35, 40, 50];
    expect(iqr(v)).toBeCloseTo(20, 12);
  });

  it('skewness of [1,2,3,4,5] = 0 (symmetric)', () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 10);
  });

  it('skewness of a right-skewed vector is positive, left-skewed is negative', () => {
    // Right-skewed: many small + one giant outlier
    expect(skewness([1, 1, 1, 1, 1, 1, 1, 1, 1, 100])).toBeGreaterThan(2);
    // Left-skewed: many high + one tiny outlier
    expect(skewness([100, 100, 100, 100, 100, 100, 100, 100, 100, 1])).toBeLessThan(-2);
  });

  it('kurtosis of [1,2,3,4,5,6,7,8,9,10] matches Excel KURT = -1.20...', () => {
    // Excel KURT (excess, type-2) = -1.2 exactly for a uniform integer 1..10.
    expect(kurtosis([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(-1.2, 6);
  });

  it('mode picks all ties — [1,2,2,3,3,4] → [2, 3]', () => {
    expect(mode([1, 2, 2, 3, 3, 4])).toEqual([2, 3]);
  });

  it('histogram on uniform [1..10] with k=5 returns 5 bins of count 2', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.k).toBe(5);
    expect(h.counts).toEqual([2, 2, 2, 2, 2]);
  });

  it('describe() composes all primitives into a single object', () => {
    const r = describeStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(r.n).toBe(8);
    expect(r.mean).toBeCloseTo(5, 12);
    expect(r.variance).toBeCloseTo(32 / 7, 12);
    expect(r.stddev).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(r.min).toBe(2);
    expect(r.max).toBe(9);
    expect(r.range).toBe(7);
  });
});
