/**
 * Ordinary Least Squares regression via the normal equations.
 *
 *   β̂ = (Xᵀ X)^(−1) Xᵀ y
 *
 * The first column of `X` is the intercept; if `addIntercept = true`
 * (default) we prepend a column of ones.
 *
 * Reference: Legendre (1805), Gauss (1809). Modern textbook treatment:
 * Hastie, Tibshirani & Friedman, *The Elements of Statistical Learning*,
 * 2nd ed., Springer 2009, §3.2. URL: <https://hastie.su.domains/ElemStatLearn/>.
 * Date checked: 2026-05-27.
 */

import type { Matrix } from '../util/matrix.js';
import { transpose, matMul, matVec, solveLinearSystem } from '../util/matrix.js';
import type { RegressionResult } from '../types.js';
import { mean } from '../descriptive/mean.js';

function addInterceptColumn(X: Matrix): number[][] {
  const out: number[][] = [];
  for (const row of X) {
    out.push([1, ...row]);
  }
  return out;
}

export function ols(
  X: Matrix,
  y: ReadonlyArray<number>,
  addIntercept: boolean = true,
): RegressionResult {
  if (X.length === 0) throw new Error('ols: empty X');
  if (X.length !== y.length) {
    throw new Error('ols: X rows must equal y length');
  }
  const Xfull = addIntercept ? addInterceptColumn(X) : X.map((r) => [...r]);
  const Xt = transpose(Xfull);
  const XtX = matMul(Xt, Xfull);
  const Xty = matVec(Xt, y);
  const beta = solveLinearSystem(XtX, Xty);
  // Compute predictions, residuals, R², MSE.
  const yhat = matVec(Xfull, beta);
  const ybar = mean(y);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < y.length; i += 1) {
    const yi = y[i] as number;
    const yh = yhat[i] as number;
    ssRes += (yi - yh) * (yi - yh);
    ssTot += (yi - ybar) * (yi - ybar);
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const nObservations = y.length;
  const nFeatures = (Xfull[0] as ReadonlyArray<number>).length;
  return {
    model: 'ols',
    coefficients: beta,
    nObservations,
    nFeatures,
    r2,
    mse: ssRes / nObservations,
    loss: ssRes,
  };
}
