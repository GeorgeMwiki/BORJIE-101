/**
 * z-score threshold detector — reference-vector tests.
 *
 * Validates the textbook 3-sigma rule on a deterministic synthetic
 * series with planted outliers.
 */

import { describe, expect, it } from 'vitest';

import {
  detectZScoreAnomaly,
  fitZScore,
  scoreZ,
} from '../detectors/zscore-threshold.js';
import { univariateGaussianWithOutliers } from '../__fixtures__/synthetic-series.js';

describe('zscore-threshold', () => {
  it('fitZScore recovers mu=0, sigma=1 on a long N(0,1) sample (T1 baseline)', () => {
    const { data } = univariateGaussianWithOutliers({
      n: 5000,
      mu: 0,
      sigma: 1,
      numOutliers: 0,
      outlierMagnitude: 0,
      seed: 42,
    });
    const { mu, sigma } = fitZScore(data);
    expect(Math.abs(mu)).toBeLessThan(0.05);
    expect(Math.abs(sigma - 1)).toBeLessThan(0.05);
  });

  it('scoreZ on mu=0, sigma=1 returns score 3 for value 3 (T5 — 3-sigma rule)', () => {
    const score = scoreZ(3, { mu: 0, sigma: 1 });
    expect(score.score).toBeCloseTo(3, 12);
    expect(score.scoreKind).toBe('zscore');
    expect(score.anomalous).toBe(true);
    expect(score.threshold).toBe(3);
  });

  it('scoreZ on mu=0, sigma=1 returns score -3 for value -3 (T6)', () => {
    const score = scoreZ(-3, { mu: 0, sigma: 1 });
    expect(score.score).toBeCloseTo(-3, 12);
    expect(score.anomalous).toBe(true);
  });

  it('detectZScoreAnomaly flags a planted +5σ outlier', () => {
    const { data } = univariateGaussianWithOutliers({
      n: 1000,
      mu: 10,
      sigma: 2,
      numOutliers: 0,
      outlierMagnitude: 0,
      seed: 17,
    });
    const verdict = detectZScoreAnomaly(data, 20); // (20-10)/2 = 5
    expect(verdict.anomalous).toBe(true);
    expect(verdict.score).toBeGreaterThan(3);
  });

  it('throws on degenerate σ=0 input', () => {
    expect(() => fitZScore([5, 5, 5, 5, 5])).toThrow(/sigma is zero/);
  });

  it('does not mutate input array', () => {
    const data = [1, 2, 3, 4, 5];
    const snapshot = [...data];
    fitZScore(data);
    expect(data).toEqual(snapshot);
  });
});
