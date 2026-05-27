/**
 * Synthetic labelled fixtures for detector validation.
 *
 * Every series here is **deterministic** (seeded PRNG) and **labelled**:
 * we return both the data vector and the indices at which we planted
 * outliers. Tests then assert detector precision / recall against the
 * known labels — no "approximately equal", no hidden randomness.
 */

import { createSeededRng } from './seeded-rng.js';

export interface LabelledSeries {
  readonly data: ReadonlyArray<number>;
  readonly outlierIndices: ReadonlyArray<number>;
}

export interface LabelledMatrix {
  readonly data: ReadonlyArray<ReadonlyArray<number>>;
  readonly outlierIndices: ReadonlyArray<number>;
}

/**
 * One-dimensional Gaussian inlier series with `numOutliers` planted at
 * deterministic indices, with large magnitude. Used by z-score, MAD,
 * and the simple univariate iForest tests.
 */
export function univariateGaussianWithOutliers(opts: {
  readonly n: number;
  readonly mu: number;
  readonly sigma: number;
  readonly numOutliers: number;
  readonly outlierMagnitude: number;
  readonly seed: number;
}): LabelledSeries {
  const rng = createSeededRng(opts.seed);
  const data: number[] = [];
  for (let i = 0; i < opts.n; i += 1) {
    data.push(rng.nextGaussian(opts.mu, opts.sigma));
  }
  // Place outliers at evenly spaced indices so tests are deterministic.
  const outlierIndices: number[] = [];
  for (let k = 0; k < opts.numOutliers; k += 1) {
    const idx = Math.floor(((k + 1) * opts.n) / (opts.numOutliers + 1));
    const sign = k % 2 === 0 ? 1 : -1;
    data[idx] = opts.mu + sign * opts.outlierMagnitude * opts.sigma;
    outlierIndices.push(idx);
  }
  return { data, outlierIndices };
}

/**
 * Two-dimensional Gaussian blob with `numOutliers` planted as points
 * far outside the blob's support. Used by LOF and multivariate iForest
 * tests.
 */
export function bivariateGaussianBlobWithOutliers(opts: {
  readonly n: number;
  readonly mu: readonly [number, number];
  readonly sigma: number;
  readonly numOutliers: number;
  readonly outlierShift: number;
  readonly seed: number;
}): LabelledMatrix {
  const rng = createSeededRng(opts.seed);
  const data: number[][] = [];
  for (let i = 0; i < opts.n; i += 1) {
    data.push([
      rng.nextGaussian(opts.mu[0], opts.sigma),
      rng.nextGaussian(opts.mu[1], opts.sigma),
    ]);
  }
  const outlierIndices: number[] = [];
  for (let k = 0; k < opts.numOutliers; k += 1) {
    const idx = Math.floor(((k + 1) * opts.n) / (opts.numOutliers + 1));
    const sign = k % 2 === 0 ? 1 : -1;
    data[idx] = [
      opts.mu[0] + sign * opts.outlierShift,
      opts.mu[1] + sign * opts.outlierShift,
    ];
    outlierIndices.push(idx);
  }
  return { data, outlierIndices };
}

/**
 * Synthetic stream with a sudden mean shift at the midpoint. Used by
 * ADWIN, KSWIN, and Page-Hinkley tests.
 */
export function meanShiftStream(opts: {
  readonly n: number;
  readonly muBefore: number;
  readonly muAfter: number;
  readonly sigma: number;
  readonly seed: number;
}): { readonly data: ReadonlyArray<number>; readonly shiftIndex: number } {
  const rng = createSeededRng(opts.seed);
  const shiftIndex = Math.floor(opts.n / 2);
  const data: number[] = [];
  for (let i = 0; i < opts.n; i += 1) {
    const mu = i < shiftIndex ? opts.muBefore : opts.muAfter;
    data.push(rng.nextGaussian(mu, opts.sigma));
  }
  return { data, shiftIndex };
}

/**
 * Stable Gaussian stream — no shift. Used to assert zero
 * false-positives on drift detectors.
 */
export function stableGaussianStream(opts: {
  readonly n: number;
  readonly mu: number;
  readonly sigma: number;
  readonly seed: number;
}): ReadonlyArray<number> {
  const rng = createSeededRng(opts.seed);
  const data: number[] = [];
  for (let i = 0; i < opts.n; i += 1) {
    data.push(rng.nextGaussian(opts.mu, opts.sigma));
  }
  return data;
}
