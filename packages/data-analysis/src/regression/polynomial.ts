/**
 * Polynomial regression — builds a Vandermonde matrix and defers to OLS.
 *
 *   y ≈ β₀ + β₁ x + β₂ x² + … + β_d x^d
 */

import { ols } from './ols.js';
import type { RegressionResult } from '../types.js';

export function polynomial(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
  degree: number,
): RegressionResult {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new Error(`polynomial: degree must be ≥ 1; got ${degree}`);
  }
  if (x.length !== y.length) {
    throw new Error('polynomial: x and y must have equal length');
  }
  const X: number[][] = [];
  for (const xi of x) {
    const row: number[] = [];
    let power = xi;
    for (let d = 1; d <= degree; d += 1) {
      row.push(power);
      power *= xi;
    }
    X.push(row);
  }
  const r = ols(X, y, true);
  return { ...r, model: 'polynomial' };
}
