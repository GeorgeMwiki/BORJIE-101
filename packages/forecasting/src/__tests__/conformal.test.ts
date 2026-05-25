/**
 * Conformal prediction — live-behaviour tests.
 *
 * These tests drive the REAL inductive-conformal implementation with
 * REAL pseudo-random calibration streams and check the frequentist
 * coverage guarantee empirically over many draws. No mocks — the
 * calibrator does real work; the seed is deterministic so runs are
 * reproducible across machines.
 */

import { describe, it, expect } from 'vitest';
import {
  createAbsoluteResidualCalibrator,
  createProbabilityCalibrator,
  quantile,
} from '../conformal/inductive.js';

/** Deterministic Park-Miller PRNG — seeded, platform-stable. */
function prng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function gaussian(rand: () => number): number {
  // Box-Muller
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('conformal / quantile', () => {
  it('returns the unique value for a one-element array', () => {
    expect(quantile([42], 0.5)).toBe(42);
  });

  it('interpolates linearly between adjacent values', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });

  it('rejects an empty array', () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/);
  });

  it('rejects p outside [0,1]', () => {
    expect(() => quantile([1, 2], -0.1)).toThrow();
    expect(() => quantile([1, 2], 1.1)).toThrow();
  });
});

describe('conformal / absolute-residual calibrator', () => {
  it('refuses to price an interval below the calibration floor', () => {
    const c = createAbsoluteResidualCalibrator({ minCalibrationPoints: 10 });
    for (let i = 0; i < 5; i += 1) c.update({ predicted: 0, actual: 1 });
    expect(() => c.interval(0, 0.1)).toThrow(/calibration/);
  });

  it('produces coverage ≥ 1 - alpha on a well-behaved distribution', () => {
    // Draw 1000 (predicted, actual) pairs where actual = predicted +
    // N(0, 1). Take first 200 as calibration, last 800 as test.
    const rand = prng(424242);
    const calib = createAbsoluteResidualCalibrator({ minCalibrationPoints: 30 });
    const pairs: Array<{ predicted: number; actual: number }> = [];
    for (let i = 0; i < 1000; i += 1) {
      const predicted = gaussian(rand);
      const actual = predicted + gaussian(rand);
      pairs.push({ predicted, actual });
    }
    for (let i = 0; i < 200; i += 1) calib.update(pairs[i]!);

    const alpha = 0.1;
    let covered = 0;
    for (let i = 200; i < 1000; i += 1) {
      const { predicted, actual } = pairs[i]!;
      const { lower, upper } = calib.interval(predicted, alpha);
      if (actual >= lower && actual <= upper) covered += 1;
    }
    const coverage = covered / 800;
    // Allow a 3% slack for finite-sample noise.
    expect(coverage).toBeGreaterThanOrEqual(1 - alpha - 0.03);
  });

  it('clips to [0,1] when the flag is on', () => {
    const c = createAbsoluteResidualCalibrator({
      minCalibrationPoints: 5,
      clipToUnitInterval: true,
    });
    for (let i = 0; i < 10; i += 1) c.update({ predicted: 0.5, actual: 0.5 });
    for (let i = 0; i < 10; i += 1) c.update({ predicted: 0.5, actual: 1.0 });
    const iv = c.interval(0.5, 0.1);
    expect(iv.lower).toBeGreaterThanOrEqual(0);
    expect(iv.upper).toBeLessThanOrEqual(1);
  });

  it('respects the rolling-window cap', () => {
    const c = createAbsoluteResidualCalibrator({
      minCalibrationPoints: 3,
      rollingWindow: 100,
    });
    for (let i = 0; i < 500; i += 1) c.update({ predicted: i, actual: i });
    expect(c.size).toBe(100);
  });
});

describe('conformal / probability calibrator', () => {
  it('refuses probabilities outside [0,1]', () => {
    const c = createProbabilityCalibrator({ minCalibrationPoints: 3 });
    expect(() => c.update({ predicted: -0.1, actual: 0 })).toThrow();
    expect(() => c.update({ predicted: 1.1, actual: 0 })).toThrow();
  });

  it('keeps the interval inside [0,1]', () => {
    const c = createProbabilityCalibrator({ minCalibrationPoints: 5 });
    const rand = prng(101);
    for (let i = 0; i < 50; i += 1) {
      const p = rand();
      const y = rand() < p ? 1 : 0;
      c.update({ predicted: p, actual: y });
    }
    const iv = c.interval(0.3, 0.1);
    expect(iv.lower).toBeGreaterThanOrEqual(0);
    expect(iv.upper).toBeLessThanOrEqual(1);
  });
});
