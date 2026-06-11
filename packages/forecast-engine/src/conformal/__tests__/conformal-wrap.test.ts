/**
 * Conformal wrapper — the coverage-guarantee proof on synthetic data.
 *
 * We generate a deterministic synthetic distribution, split it into a
 * calibration set and a test set, calibrate a constant predictor, and
 * assert empirical coverage on the held-out test set is >= the nominal
 * coverage (the split-conformal guarantee, up to finite-sample slack).
 */

import { describe, it, expect } from 'vitest';
import {
  calibrateForecast,
  type CalibrationRecord,
} from '../conformal-wrap.js';
import type { RawForecast } from '../../types.js';

/** Deterministic LCG so the test is reproducible (no Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Box-Muller using the deterministic LCG => standard-normal samples. */
function gaussian(rand: () => number): number {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('split-conformal coverage guarantee (synthetic)', () => {
  it('achieves >= nominal coverage on held-out data (split mode)', () => {
    const rand = lcg(20260608);
    const mu = 100;
    const sigma = 5;
    const point = mu; // a constant predictor at the true mean
    const N = 4000;

    // Calibration set: residual = |actual - point|.
    const calibration: CalibrationRecord[] = [];
    for (let i = 0; i < N; i++) {
      const actual = mu + sigma * gaussian(rand);
      calibration.push({
        point,
        actual,
        lowerQuantile: point,
        upperQuantile: point,
      });
    }

    const targetCoverage = 0.9;
    // Build a single-step raw forecast at the constant point.
    const raw: RawForecast = {
      model: 'const',
      modelVersion: '1.0.0',
      steps: [
        {
          step: 1,
          point,
          quantiles: { '0.05': point, '0.5': point, '0.95': point },
        },
      ],
      latencyMs: 0,
    };

    const wrapped = calibrateForecast(raw, calibration, {
      targetCoverage,
      mode: 'split',
    });
    const interval = wrapped.intervals[0]!;

    // Independent test set: measure empirical coverage.
    let covered = 0;
    const M = 4000;
    for (let i = 0; i < M; i++) {
      const actual = mu + sigma * gaussian(rand);
      if (actual >= interval.lower && actual <= interval.upper) covered += 1;
    }
    const empirical = covered / M;
    expect(empirical).toBeGreaterThanOrEqual(targetCoverage - 0.02);
    // Sanity: an honest interval should not be absurdly wide (< 6 sigma).
    expect(interval.upper - interval.lower).toBeLessThan(6 * sigma);
  });

  it('CQR mode also attains nominal coverage and is finite', () => {
    const rand = lcg(424242);
    const mu = 0;
    const sigma = 2;
    const targetCoverage = 0.9;
    const alpha = 1 - targetCoverage;
    const N = 3000;

    const calibration: CalibrationRecord[] = [];
    for (let i = 0; i < N; i++) {
      const actual = mu + sigma * gaussian(rand);
      calibration.push({
        point: mu,
        actual,
        // provider's nominal 90% quantiles for a unit-ish normal
        lowerQuantile: mu - 1.2816 * sigma,
        upperQuantile: mu + 1.2816 * sigma,
      });
    }

    const raw: RawForecast = {
      model: 'q',
      modelVersion: '1.0.0',
      steps: [
        {
          step: 1,
          point: mu,
          quantiles: {
            [String(alpha / 2)]: mu - 1.2816 * sigma,
            '0.5': mu,
            [String(1 - alpha / 2)]: mu + 1.2816 * sigma,
          },
        },
      ],
      latencyMs: 0,
    };

    const wrapped = calibrateForecast(raw, calibration, {
      targetCoverage,
      mode: 'cqr',
    });
    const interval = wrapped.intervals[0]!;
    expect(Number.isFinite(interval.lower)).toBe(true);
    expect(Number.isFinite(interval.upper)).toBe(true);

    let covered = 0;
    const M = 4000;
    for (let i = 0; i < M; i++) {
      const actual = mu + sigma * gaussian(rand);
      if (actual >= interval.lower && actual <= interval.upper) covered += 1;
    }
    expect(covered / M).toBeGreaterThanOrEqual(targetCoverage - 0.02);
  });

  it('returns an unbounded interval (never under-covers) when calibration is empty', () => {
    const raw: RawForecast = {
      model: 'const',
      modelVersion: '1.0.0',
      steps: [{ step: 1, point: 1, quantiles: { '0.5': 1 } }],
      latencyMs: 0,
    };
    const wrapped = calibrateForecast(raw, [], { targetCoverage: 0.9, mode: 'split' });
    const interval = wrapped.intervals[0]!;
    expect(interval.lower).toBe(Number.NEGATIVE_INFINITY);
    expect(interval.upper).toBe(Number.POSITIVE_INFINITY);
  });

  it('higher target coverage yields a wider interval', () => {
    const rand = lcg(7);
    const calibration: CalibrationRecord[] = [];
    for (let i = 0; i < 2000; i++) {
      const actual = 50 + 3 * gaussian(rand);
      calibration.push({ point: 50, actual, lowerQuantile: 50, upperQuantile: 50 });
    }
    const raw: RawForecast = {
      model: 'c',
      modelVersion: '1',
      steps: [{ step: 1, point: 50, quantiles: { '0.5': 50 } }],
      latencyMs: 0,
    };
    const w90 = calibrateForecast(raw, calibration, { targetCoverage: 0.9, mode: 'split' });
    const w99 = calibrateForecast(raw, calibration, { targetCoverage: 0.99, mode: 'split' });
    const width90 = w90.intervals[0]!.upper - w90.intervals[0]!.lower;
    const width99 = w99.intervals[0]!.upper - w99.intervals[0]!.lower;
    expect(width99).toBeGreaterThan(width90);
  });
});
