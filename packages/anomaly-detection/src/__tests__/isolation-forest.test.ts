/**
 * Isolation Forest — synthetic-data precision validation.
 *
 * Acceptance criteria from the spec:
 *   T1. precision ≥ 0.85 at 1% contamination, n_trees=100, psi=256.
 *   T2. score range bounded [0, 1].
 */

import { describe, expect, it } from 'vitest';

import {
  averagePathLength,
  detectIsolationForestAnomalies,
  fitIsolationForest,
  scoreIsolationForest,
} from '../detectors/isolation-forest.js';
import {
  bivariateGaussianBlobWithOutliers,
  univariateGaussianWithOutliers,
} from '../__fixtures__/synthetic-series.js';

describe('isolation-forest', () => {
  it('averagePathLength matches the published normaliser for small n', () => {
    expect(averagePathLength(2)).toBeCloseTo(2 * 0.5772156649 - 1, 6);
    expect(averagePathLength(1)).toBe(0);
    expect(averagePathLength(0)).toBe(0);
  });

  it('score range bounded [0, 1] for all inputs (T2)', () => {
    const { data } = univariateGaussianWithOutliers({
      n: 500,
      mu: 0,
      sigma: 1,
      numOutliers: 10,
      outlierMagnitude: 6,
      seed: 7,
    });
    const matrix = data.map((v) => [v]);
    const scores = detectIsolationForestAnomalies(matrix, {
      nTrees: 50,
      psi: 128,
      seed: 7,
    });
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.scoreKind).toBe('iforest');
    }
  });

  it('precision >= 0.85 on 1% planted outliers in 2D Gaussian blob (T1)', () => {
    const n = 1000;
    const numOutliers = 10; // 1% contamination
    const { data, outlierIndices } = bivariateGaussianBlobWithOutliers({
      n,
      mu: [0, 0],
      sigma: 1,
      numOutliers,
      outlierShift: 8,
      seed: 11,
    });
    const model = fitIsolationForest(data, {
      nTrees: 100,
      psi: 256,
      seed: 11,
    });
    // Score every row and take the top numOutliers by score.
    const scored = data.map((row, i) => ({
      i,
      s: scoreIsolationForest(model, row).score,
    }));
    scored.sort((a, b) => b.s - a.s);
    const topIdx = new Set(scored.slice(0, numOutliers).map((x) => x.i));
    const groundTruth = new Set(outlierIndices);
    let truePositives = 0;
    for (const idx of topIdx) if (groundTruth.has(idx)) truePositives += 1;
    const precision = truePositives / numOutliers;
    expect(precision).toBeGreaterThanOrEqual(0.85);
  });

  it('reseeding produces deterministic scores', () => {
    const { data } = bivariateGaussianBlobWithOutliers({
      n: 200,
      mu: [0, 0],
      sigma: 1,
      numOutliers: 2,
      outlierShift: 6,
      seed: 3,
    });
    const m1 = fitIsolationForest(data, { nTrees: 30, psi: 64, seed: 99 });
    const m2 = fitIsolationForest(data, { nTrees: 30, psi: 64, seed: 99 });
    for (let i = 0; i < data.length; i += 1) {
      const s1 = scoreIsolationForest(m1, data[i]!).score;
      const s2 = scoreIsolationForest(m2, data[i]!).score;
      expect(s1).toBeCloseTo(s2, 12);
    }
  });

  it('rejects dimension mismatch at scoring time', () => {
    const data = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const model = fitIsolationForest(data, { nTrees: 5, psi: 3, seed: 1 });
    expect(() => scoreIsolationForest(model, [1])).toThrow(/dimension mismatch/);
  });
});
