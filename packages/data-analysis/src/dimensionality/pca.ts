/**
 * Principal Component Analysis on the covariance matrix via Jacobi
 * eigendecomposition.
 *
 *   1. Centre X by column means.
 *   2. Σ = (Xᵀ X) / (n − 1).
 *   3. Eigendecomposition of Σ → eigenvectors are PCs, eigenvalues
 *      are component variances.
 *   4. Project: X_new = X_centred · V.
 *
 * Reference: Pearson, K. (1901). *On lines and planes of closest fit
 * to systems of points in space.* Philosophical Magazine 2(11):559-572.
 * URL: <https://www.tandfonline.com/doi/abs/10.1080/14786440109462720>.
 * Date checked: 2026-05-27.
 */

import type { PcaResult } from '../types.js';
import { symmetricEig, transpose, zeros, type Matrix } from '../util/matrix.js';

export function pca(
  X: Matrix,
  nComponents?: number,
): PcaResult {
  if (X.length === 0) throw new Error('pca: empty X');
  const n = X.length;
  const p = (X[0] as ReadonlyArray<number>).length;
  if (n < 2) throw new Error('pca: need n ≥ 2');
  const k = nComponents ?? p;
  if (k < 1 || k > p) throw new Error(`pca: nComponents out of range; got ${k}`);
  // Centre.
  const means = new Array<number>(p).fill(0);
  for (const row of X) {
    for (let j = 0; j < p; j += 1) {
      means[j] = (means[j] as number) + (row[j] as number);
    }
  }
  for (let j = 0; j < p; j += 1) means[j] = (means[j] as number) / n;
  const Xc = zeros(n, p);
  for (let i = 0; i < n; i += 1) {
    const row = X[i] as ReadonlyArray<number>;
    for (let j = 0; j < p; j += 1) {
      (Xc[i] as number[])[j] = (row[j] as number) - (means[j] as number);
    }
  }
  // Covariance Σ = XᵀX / (n − 1)
  const cov = zeros(p, p);
  for (let i = 0; i < n; i += 1) {
    const row = Xc[i] as number[];
    for (let a = 0; a < p; a += 1) {
      const ra = row[a] as number;
      for (let b = a; b < p; b += 1) {
        (cov[a] as number[])[b] =
          ((cov[a] as number[])[b] as number) + ra * (row[b] as number);
      }
    }
  }
  for (let a = 0; a < p; a += 1) {
    for (let b = a; b < p; b += 1) {
      (cov[a] as number[])[b] =
        ((cov[a] as number[])[b] as number) / (n - 1);
      (cov[b] as number[])[a] = (cov[a] as number[])[b] as number;
    }
  }
  const { values, vectors } = symmetricEig(cov);
  // vectors columns are PCs sorted descending. Take top-k.
  const components: number[][] = [];
  for (let j = 0; j < k; j += 1) {
    const comp: number[] = [];
    for (let i = 0; i < p; i += 1) {
      comp.push((vectors[i] as ReadonlyArray<number>)[j] as number);
    }
    components.push(comp);
  }
  const eigenvalues = values.slice(0, k);
  let totalVar = 0;
  for (const v of values) totalVar += Math.max(0, v);
  const explainedVarianceRatio = eigenvalues.map((v) =>
    totalVar === 0 ? 0 : v / totalVar,
  );
  const cumulativeExplained: number[] = [];
  let cum = 0;
  for (const e of explainedVarianceRatio) {
    cum += e;
    cumulativeExplained.push(cum);
  }
  // Transform: X_new[i][j] = Xc[i] · components[j]
  const compT = transpose(components);  // p × k
  const transformed = zeros(n, k);
  for (let i = 0; i < n; i += 1) {
    const row = Xc[i] as number[];
    for (let j = 0; j < k; j += 1) {
      let s = 0;
      for (let a = 0; a < p; a += 1) {
        s += (row[a] as number) * ((compT[a] as number[])[j] as number);
      }
      (transformed[i] as number[])[j] = s;
    }
  }
  return {
    components,
    eigenvalues,
    explainedVarianceRatio,
    cumulativeExplained,
    transformed,
  };
}
