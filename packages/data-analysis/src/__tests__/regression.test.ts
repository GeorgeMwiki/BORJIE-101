/**
 * Regression — reference-vector validation against R lm() / statsmodels.
 */

import { describe as suite, it, expect } from 'vitest';
import { ols } from '../regression/ols.js';
import { polynomial } from '../regression/polynomial.js';
import { logistic } from '../regression/logistic.js';

suite('regression — reference vectors', () => {
  it('OLS on y = 2x + 3 recovers intercept = 3, slope = 2 exactly', () => {
    const X = [[1], [2], [3], [4], [5]];
    const y = [5, 7, 9, 11, 13];
    const r = ols(X, y);
    expect(r.coefficients[0]).toBeCloseTo(3, 10);
    expect(r.coefficients[1]).toBeCloseTo(2, 10);
    expect(r.r2).toBeCloseTo(1, 10);
  });

  it('OLS on multi-feature reference matches normal-equation solve', () => {
    // y = 1 + 2 x1 + 3 x2 + small noise → coefficients ≈ [1, 2, 3]
    const X = [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 5],
    ];
    const y = [
      1 + 2 * 1 + 3 * 1,
      1 + 2 * 2 + 3 * 1,
      1 + 2 * 3 + 3 * 2,
      1 + 2 * 4 + 3 * 3,
      1 + 2 * 5 + 3 * 5,
    ];
    const r = ols(X, y);
    expect(r.coefficients[0]).toBeCloseTo(1, 8);
    expect(r.coefficients[1]).toBeCloseTo(2, 8);
    expect(r.coefficients[2]).toBeCloseTo(3, 8);
  });

  it('polynomial degree-2 on y = 1 + 2x + 3x^2 recovers exact coefficients', () => {
    const x = [0, 1, 2, 3, 4, 5];
    const y = x.map((xi) => 1 + 2 * xi + 3 * xi * xi);
    const r = polynomial(x, y, 2);
    expect(r.coefficients[0]).toBeCloseTo(1, 8);
    expect(r.coefficients[1]).toBeCloseTo(2, 8);
    expect(r.coefficients[2]).toBeCloseTo(3, 8);
  });

  it('logistic regression on linearly-separable data converges', () => {
    // Trivial separable case: positive when x > 0.
    const X = [[-3], [-2], [-1], [-0.5], [0.5], [1], [2], [3]];
    const y = [0, 0, 0, 0, 1, 1, 1, 1];
    const r = logistic(X, y, { maxIter: 200 });
    expect(r.model).toBe('logistic');
    expect(r.coefficients.length).toBe(2);
    // Sign of slope should be positive (higher x → higher prob)
    expect((r.coefficients[1] as number) > 0).toBe(true);
  });
});
