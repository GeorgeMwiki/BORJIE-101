/**
 * Dimensionality reduction — PCA on Iris, UMAP-lite smoke test.
 */

import { describe as suite, it, expect } from 'vitest';
import { pca } from '../dimensionality/pca.js';
import { umapLite } from '../dimensionality/umap-port.js';
import { IRIS_X } from '../__fixtures__/iris.js';

suite('dimensionality — reference vectors', () => {
  it('PCA on raw Iris matrix: PC1 explained variance ≈ 0.92', () => {
    // Classic result: on the raw (non-standardised) covariance, PC1
    // dominated by petal length explains ~92.5% of variance.
    const X = IRIS_X.map((r) => [...r]);
    const result = pca(X);
    const ratio = result.explainedVarianceRatio[0] as number;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(0.95);
    // Cumulative should sum to 1 across all components.
    const last = result.cumulativeExplained[result.cumulativeExplained.length - 1] as number;
    expect(last).toBeCloseTo(1, 6);
  });

  it('PCA components have unit norm and 4-D Iris yields 4 components', () => {
    const X = IRIS_X.map((r) => [...r]);
    const result = pca(X);
    expect(result.components.length).toBe(4);
    for (const c of result.components) {
      let norm = 0;
      for (const v of c) norm += v * v;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 6);
    }
  });

  it('UMAP-lite runs deterministically with a seed', () => {
    const X = IRIS_X.slice(0, 30).map((r) => [...r]);
    const a = umapLite(X, { seed: 7, nIter: 50, nNeighbors: 5 });
    const b = umapLite(X, { seed: 7, nIter: 50, nNeighbors: 5 });
    expect(a.length).toBe(30);
    expect(b.length).toBe(30);
    for (let i = 0; i < 30; i += 1) {
      expect((a[i] as number[])[0]).toBeCloseTo((b[i] as number[])[0] as number, 6);
      expect((a[i] as number[])[1]).toBeCloseTo((b[i] as number[])[1] as number, 6);
    }
  });
});
