/**
 * Local Outlier Factor — density-outlier validation.
 *
 * Acceptance criteria:
 *   T3. LOF flags a density outlier embedded in a Gaussian blob.
 *   T4. LOF score ≈ 1 for inliers, ≫ 1 for outliers.
 */

import { describe, expect, it } from 'vitest';

import { detectLocalOutlierFactor } from '../detectors/local-outlier-factor.js';
import { bivariateGaussianBlobWithOutliers } from '../__fixtures__/synthetic-series.js';

describe('local-outlier-factor', () => {
  it('flags a density outlier embedded in a Gaussian blob (T3)', () => {
    const { data, outlierIndices } = bivariateGaussianBlobWithOutliers({
      n: 100,
      mu: [0, 0],
      sigma: 0.5,
      numOutliers: 3,
      outlierShift: 10,
      seed: 17,
    });
    const { scores } = detectLocalOutlierFactor(data, { k: 10, threshold: 1.5 });
    const flagged = new Set(
      scores
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.anomalous)
        .map(({ i }) => i),
    );
    // Every planted outlier must be flagged.
    for (const idx of outlierIndices) {
      expect(flagged.has(idx)).toBe(true);
    }
  });

  it('LOF ~ 1 for inliers and >> 1 for outliers (T4)', () => {
    const { data, outlierIndices } = bivariateGaussianBlobWithOutliers({
      n: 80,
      mu: [0, 0],
      sigma: 0.3,
      numOutliers: 2,
      outlierShift: 8,
      seed: 23,
    });
    const { scores } = detectLocalOutlierFactor(data, { k: 10 });
    const inlierScores = scores.filter((_, i) => !outlierIndices.includes(i));
    const outlierScores = outlierIndices.map((i) => scores[i]!.score);
    const meanInlier =
      inlierScores.reduce((s, x) => s + x.score, 0) / inlierScores.length;
    // Inlier mean LOF should hug 1 (allow 0.5 - 1.5 slack for finite n).
    expect(meanInlier).toBeGreaterThan(0.5);
    expect(meanInlier).toBeLessThan(2);
    // Outliers should have LOF much higher than mean inlier.
    for (const s of outlierScores) {
      expect(s).toBeGreaterThan(meanInlier * 2);
    }
  });

  it('throws when k >= n', () => {
    const data = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    expect(() => detectLocalOutlierFactor(data, { k: 5 })).toThrow(/need more than k/);
  });
});
