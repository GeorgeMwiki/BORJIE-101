/**
 * Logistic regression via Iteratively Re-weighted Least Squares (IRLS).
 *
 * Each step solves a weighted least squares:
 *   β_{t+1} = (Xᵀ W X)^(−1) Xᵀ W z
 * with W = diag(p_i (1 − p_i)) and z_i = Xβ_t + (y_i − p_i) / (p_i (1 − p_i)).
 *
 * Reference: Hastie, Tibshirani & Friedman, *The Elements of Statistical
 * Learning*, 2nd ed., Springer 2009, §4.4.1.
 * URL: <https://hastie.su.domains/ElemStatLearn/>. Date checked: 2026-05-27.
 */

import type { RegressionResult } from '../types.js';
import type { Matrix } from '../util/matrix.js';
import { transpose, matVec, solveLinearSystem, zeros } from '../util/matrix.js';

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function addInterceptColumn(X: Matrix): number[][] {
  const out: number[][] = [];
  for (const row of X) {
    out.push([1, ...row]);
  }
  return out;
}

export interface LogisticOptions {
  readonly maxIter?: number;
  readonly tol?: number;
  readonly addIntercept?: boolean;
}

export function logistic(
  X: Matrix,
  y: ReadonlyArray<number>,
  opts: LogisticOptions = {},
): RegressionResult {
  const addIntercept = opts.addIntercept ?? true;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-8;
  if (X.length !== y.length) {
    throw new Error('logistic: X rows must equal y length');
  }
  for (const yi of y) {
    if (yi !== 0 && yi !== 1) {
      throw new Error('logistic: y must be 0/1');
    }
  }
  const Xfull = addIntercept ? addInterceptColumn(X) : X.map((r) => [...r]);
  const n = Xfull.length;
  const p = (Xfull[0] as ReadonlyArray<number>).length;
  let beta = new Array<number>(p).fill(0);
  let converged = false;
  let iter = 0;
  let nll = Number.POSITIVE_INFINITY;
  for (iter = 0; iter < maxIter; iter += 1) {
    const eta = matVec(Xfull, beta);
    const probs = eta.map((e) => sigmoid(e));
    // Build XᵀWX and XᵀWz where z is the working response.
    const Xt = transpose(Xfull);
    const W = new Array<number>(n);
    const z = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const pi = probs[i] as number;
      const wi = Math.max(pi * (1 - pi), 1e-10);
      W[i] = wi;
      z[i] = (eta[i] as number) + ((y[i] as number) - pi) / wi;
    }
    const XtWX: number[][] = zeros(p, p);
    const XtWz = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i += 1) {
      const row = Xfull[i] as ReadonlyArray<number>;
      const wi = W[i] as number;
      const zi = z[i] as number;
      for (let a = 0; a < p; a += 1) {
        const ra = row[a] as number;
        XtWz[a] = (XtWz[a] as number) + wi * ra * zi;
        for (let b = 0; b < p; b += 1) {
          (XtWX[a] as number[])[b] =
            ((XtWX[a] as number[])[b] as number) + wi * ra * (row[b] as number);
        }
      }
      void Xt; // silence unused-var warning if not needed
    }
    const newBeta = solveLinearSystem(XtWX, XtWz);
    let delta = 0;
    for (let i = 0; i < p; i += 1) {
      delta += Math.abs((newBeta[i] as number) - (beta[i] as number));
    }
    beta = newBeta;
    // Recompute NLL.
    nll = 0;
    const eta2 = matVec(Xfull, beta);
    for (let i = 0; i < n; i += 1) {
      const ei = eta2[i] as number;
      const yi = y[i] as number;
      // Stable log(1+exp(x)) = max(0, x) + log1p(exp(-|x|))
      const softplus = Math.max(0, ei) + Math.log1p(Math.exp(-Math.abs(ei)));
      nll += softplus - yi * ei;
    }
    if (delta < tol) {
      converged = true;
      break;
    }
  }
  return {
    model: 'logistic',
    coefficients: beta,
    nObservations: n,
    nFeatures: p,
    loss: nll,
    iterations: iter + 1,
    converged,
  };
}
