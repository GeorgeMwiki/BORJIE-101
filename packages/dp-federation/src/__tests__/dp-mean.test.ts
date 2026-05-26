import { describe, expect, it } from 'vitest';
import { dpMean, DpMeanError } from '../aggregate/dp-mean.js';
import type { RandomPort } from '../aggregate/dp-mean.js';

/** Deterministic RNG seeded by a Mulberry32 LCG. */
function makeDeterministicRng(seed: number): RandomPort {
  let s = seed >>> 0;
  return Object.freeze({
    uniform(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
    },
  });
}

describe('dpMean', () => {
  it('returns trueMean + Gaussian noise scaled by 2C/n * σ', () => {
    const values = [0.5, -0.3, 0.1, 0.2];
    const out = dpMean({
      values,
      clipBound: 1,
      noiseSigma: 0.1,
      random: makeDeterministicRng(42),
    });
    // True mean = (0.5 - 0.3 + 0.1 + 0.2) / 4 = 0.125
    expect(out.trueMean).toBeCloseTo(0.125, 12);
    expect(out.noiseStdDev).toBeCloseTo((2 * 1) / 4 * 0.1, 12);
  });

  it('rejects values outside [-C, C]', () => {
    expect(() =>
      dpMean({
        values: [0.5, 2.0],
        clipBound: 1,
        noiseSigma: 0.1,
        random: makeDeterministicRng(1),
      }),
    ).toThrowError(DpMeanError);
  });

  it('rejects empty values', () => {
    expect(() =>
      dpMean({
        values: [],
        clipBound: 1,
        noiseSigma: 0.1,
        random: makeDeterministicRng(1),
      }),
    ).toThrowError(DpMeanError);
  });

  it('rejects non-positive parameters', () => {
    expect(() =>
      dpMean({
        values: [0.1],
        clipBound: 0,
        noiseSigma: 0.1,
        random: makeDeterministicRng(1),
      }),
    ).toThrowError(DpMeanError);
    expect(() =>
      dpMean({
        values: [0.1],
        clipBound: 1,
        noiseSigma: 0,
        random: makeDeterministicRng(1),
      }),
    ).toThrowError(DpMeanError);
  });

  it('noise has correct standard deviation in large-N (statistical)', () => {
    // Statistical sanity: average squared deviation should approach
    // (σ · 2C/n)². We replicate the DP-mean draw N times on a degenerate
    // input (mean = 0) and check std-dev of the noise.
    const N = 4000;
    const clipBound = 1;
    const noiseSigma = 0.3;
    const n = 8;
    const expectedStd = noiseSigma * (2 * clipBound) / n;
    let sumSq = 0;
    let sum = 0;
    const rng = makeDeterministicRng(12345);
    for (let i = 0; i < N; i += 1) {
      const out = dpMean({
        values: new Array(n).fill(0),
        clipBound,
        noiseSigma,
        random: rng,
      });
      const noise = out.mean; // trueMean is 0
      sum += noise;
      sumSq += noise * noise;
    }
    const mean = sum / N;
    const variance = sumSq / N - mean * mean;
    const std = Math.sqrt(variance);
    // Tolerance proportional to expectedStd / sqrt(N).
    const tolerance = (3 * expectedStd) / Math.sqrt(N) + 0.01;
    expect(std).toBeGreaterThan(expectedStd - tolerance);
    expect(std).toBeLessThan(expectedStd + tolerance);
  });
});
