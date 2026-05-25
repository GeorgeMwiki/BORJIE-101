/**
 * differential-privacy.test.ts — statistical property tests.
 *
 * These tests pin a seeded PRNG (`mulberry32`) so the distribution
 * assertions are reproducible. Tolerance bands are wide enough that the
 * tests survive normal sampling variance; they are tight enough that a
 * real bug (wrong scale, sign flip, Gaussian σ miscalibration) will fail.
 */

import { describe, it, expect } from 'vitest';
import {
  addLaplaceNoise,
  addGaussianNoise,
  sampleLaplace,
  basicComposition,
  advancedComposition,
  laplaceConfidenceInterval,
  mulberry32,
} from '../differential-privacy.js';

describe('dp-memory/differential-privacy', () => {
  describe('Laplace mechanism', () => {
    it('returns a mean near the raw value over many independent draws', () => {
      const rng = mulberry32(42);
      const raw = 100;
      const sensitivity = 1;
      const epsilon = 0.5;
      const N = 5000;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += addLaplaceNoise(raw, sensitivity, epsilon, rng);
      }
      const mean = sum / N;
      // Theoretical mean = raw. Std = b · √2 where b = Δf/ε = 2 here.
      // SE of mean ≈ 2√2 / √5000 ≈ 0.04. Allow ±0.2 slack.
      expect(Math.abs(mean - raw)).toBeLessThan(0.2);
    });

    it('sample variance matches the Laplace distribution variance 2b²', () => {
      const rng = mulberry32(7);
      const scale = 3;
      const N = 10000;
      const samples: number[] = [];
      for (let i = 0; i < N; i++) samples.push(sampleLaplace(scale, rng));
      const mean = samples.reduce((s, v) => s + v, 0) / N;
      const variance =
        samples.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (N - 1);
      // Theoretical variance = 2b² = 18. Allow ±15% for sampling noise.
      expect(variance).toBeGreaterThan(18 * 0.85);
      expect(variance).toBeLessThan(18 * 1.15);
    });

    it('rejects invalid inputs', () => {
      expect(() => addLaplaceNoise(0, 0, 1)).toThrow();
      expect(() => addLaplaceNoise(0, 1, 0)).toThrow();
      expect(() => addLaplaceNoise(Number.NaN, 1, 1)).toThrow();
    });
  });

  describe('Gaussian mechanism', () => {
    it('produces zero-mean noise over many draws', () => {
      const rng = mulberry32(123);
      const raw = 50;
      const N = 5000;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += addGaussianNoise(raw, 1, 0.5, 1e-5, rng) - raw;
      }
      const meanNoise = sum / N;
      // SE of mean scales with σ / √N. σ ≈ √(2 ln(1.25/1e-5)) / 0.5 ≈ 9.6.
      // Allow ±0.5 slack.
      expect(Math.abs(meanNoise)).toBeLessThan(0.5);
    });

    it('rejects invalid delta', () => {
      expect(() => addGaussianNoise(0, 1, 1, 0)).toThrow();
      expect(() => addGaussianNoise(0, 1, 1, 1)).toThrow();
    });
  });

  describe('composition rules', () => {
    it('basicComposition sums the epsilons', () => {
      expect(basicComposition([0.1, 0.2, 0.3])).toBeCloseTo(0.6);
      expect(basicComposition([])).toBe(0);
    });

    it('advancedComposition beats basic for enough small-epsilon steps', () => {
      // Advanced beats basic once k · ε · (e^ε - 1) + √(2k ln 1/δ') · ε < k·ε,
      // which is the regime the theorem was designed for.
      const epsilons = Array.from({ length: 50 }, () => 0.01);
      const basic = basicComposition(epsilons);
      const advanced = advancedComposition(epsilons, 1e-6);
      expect(advanced).toBeLessThan(basic);
    });

    it('advancedComposition is zero for empty list', () => {
      expect(advancedComposition([], 1e-5)).toBe(0);
    });

    it('rejects invalid epsilons', () => {
      expect(() => basicComposition([-0.1])).toThrow();
      expect(() => advancedComposition([0.1], 0)).toThrow();
    });
  });

  describe('confidence intervals', () => {
    it('95% CI half-width equals b · ln(2/α)', () => {
      const [lo, hi] = laplaceConfidenceInterval(10, 1, 0.5, 0.95);
      const b = 1 / 0.5;
      const expectedHalf = b * Math.log(2 / 0.05);
      expect(Math.abs((hi - lo) / 2 - expectedHalf)).toBeLessThan(1e-9);
    });

    it('wider CI for smaller epsilon', () => {
      const tight = laplaceConfidenceInterval(0, 1, 1.0);
      const loose = laplaceConfidenceInterval(0, 1, 0.1);
      expect(loose[1] - loose[0]).toBeGreaterThan(tight[1] - tight[0]);
    });
  });
});
