/**
 * Granger causality test — pure TypeScript.
 *
 * Tests whether past values of X help predict future values of Y
 * beyond what Y's own past predicts. Implementation follows the
 * standard F-test on nested AR(p) vs ARX(p) models:
 *
 *   restricted:    Y_t = sum_{i=1..p} a_i * Y_{t-i} + e_t
 *   unrestricted:  Y_t = sum_{i=1..p} a_i * Y_{t-i}
 *                       + sum_{i=1..p} b_i * X_{t-i} + e_t
 *
 *   F = ((RSS_r - RSS_u) / p) / (RSS_u / (N - 2p - 1))
 *
 *   Under H_0 (X does NOT Granger-cause Y): F ~ F(p, N - 2p - 1).
 *
 * For Mr. Mwikila this answers: "do past fuel-price moves help me
 * predict next-week production volume beyond production volume's own
 * autocorrelation?". The Granger test is necessary but not sufficient
 * for causation — it cannot distinguish a true causal driver from a
 * common ancestor — which is why PCMCI+ (with conditional-
 * independence tests) is the SOTA upgrade.
 *
 * Reference: Granger, C. W. J. (1969), "Investigating causal relations
 * by econometric models and cross-spectral methods". Test oracle:
 * synthetic series y(t) = 0.6 * x(t-1) + noise must reject H_0 at
 * alpha = 0.05.
 *
 * @module @borjie/causal-inference/discovery/granger-causality
 */

import { CausalInferenceError } from '../types.js';

export interface GrangerOptions {
  /** AR order p. Default 1. */
  readonly maxLag?: number;
  /** Significance level. Default 0.05. */
  readonly alpha?: number;
}

export interface GrangerResult {
  /** F-statistic of the nested model comparison. */
  readonly fStatistic: number;
  /** Approximate p-value (asymptotic). */
  readonly pValue: number;
  /** Reject H_0 at the configured alpha? */
  readonly causal: boolean;
  /** Degrees of freedom (numerator, denominator). */
  readonly degreesOfFreedom: { readonly num: number; readonly den: number };
  /** Restricted-model residual sum of squares. */
  readonly rssRestricted: number;
  /** Unrestricted-model residual sum of squares. */
  readonly rssUnrestricted: number;
  /** Effective sample size after lag truncation. */
  readonly sampleSize: number;
}

/**
 * Run Granger causality test: does `cause` Granger-cause `effect`?
 *
 * Both series must be aligned (same length, same time index) and
 * stationary. Caller is responsible for differencing if needed.
 */
export function grangerCausality(
  cause: ReadonlyArray<number>,
  effect: ReadonlyArray<number>,
  options: GrangerOptions = {},
): GrangerResult {
  if (cause.length !== effect.length) {
    throw new CausalInferenceError(
      'INVALID_TIME_SERIES',
      'granger: cause and effect series must have equal length',
    );
  }
  const lag = Math.max(1, Math.floor(options.maxLag ?? 1));
  const alpha = options.alpha ?? 0.05;
  const n = effect.length;
  // We need at least lag + (2*lag + 1) = 3*lag + 1 observations to
  // estimate the unrestricted model; require a small safety margin.
  if (n < 3 * lag + 5) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      `granger: need at least ${3 * lag + 5} observations for lag=${lag}, got ${n}`,
    );
  }

  // Build design matrices.
  // Restricted: Y_t regressed on [const, Y_{t-1}..Y_{t-p}]
  // Unrestricted: Y_t regressed on [const, Y_{t-1}..Y_{t-p}, X_{t-1}..X_{t-p}]
  const yOut: number[] = [];
  const restrictedX: number[][] = [];
  const unrestrictedX: number[][] = [];
  for (let t = lag; t < n; t += 1) {
    yOut.push(effect[t] as number);
    const restRow: number[] = [1];
    const unrRow: number[] = [1];
    for (let k = 1; k <= lag; k += 1) {
      const yL = effect[t - k] as number;
      restRow.push(yL);
      unrRow.push(yL);
    }
    for (let k = 1; k <= lag; k += 1) {
      unrRow.push(cause[t - k] as number);
    }
    restrictedX.push(restRow);
    unrestrictedX.push(unrRow);
  }

  const rssR = ordinaryLeastSquaresRss(restrictedX, yOut);
  const rssU = ordinaryLeastSquaresRss(unrestrictedX, yOut);
  const effectiveN = yOut.length;
  const dfNum = lag;
  const dfDen = effectiveN - (2 * lag + 1);
  if (dfDen <= 0) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      `granger: denominator df <= 0 (effectiveN=${effectiveN}, lag=${lag})`,
    );
  }
  // Guard against numerical zero rssU (perfect fit edge case).
  const rssUSafe = Math.max(rssU, 1e-12);
  const fStat = ((rssR - rssU) / dfNum) / (rssUSafe / dfDen);
  const fStatPositive = Math.max(0, fStat);
  const p = fDistributionUpperTail(fStatPositive, dfNum, dfDen);
  return {
    fStatistic: fStatPositive,
    pValue: p,
    causal: p < alpha,
    degreesOfFreedom: { num: dfNum, den: dfDen },
    rssRestricted: rssR,
    rssUnrestricted: rssU,
    sampleSize: effectiveN,
  };
}

// ---------------------------------------------------------------------------
// Internals — OLS RSS via normal equations, F distribution upper tail
// ---------------------------------------------------------------------------

function ordinaryLeastSquaresRss(
  designRows: ReadonlyArray<ReadonlyArray<number>>,
  y: ReadonlyArray<number>,
): number {
  const n = designRows.length;
  if (n === 0) return 0;
  const firstRow = designRows[0];
  if (firstRow === undefined) return 0;
  const k = firstRow.length;
  // beta = (X'X)^-1 X'y via Gauss-Jordan on a k x (k+1) augmented matrix.
  const xtx: number[][] = Array.from({ length: k }, () =>
    new Array(k).fill(0) as number[],
  );
  const xty: number[] = new Array(k).fill(0) as number[];
  for (let i = 0; i < n; i += 1) {
    const row = designRows[i] as ReadonlyArray<number>;
    const yi = y[i] as number;
    for (let r = 0; r < k; r += 1) {
      const rowR = row[r] as number;
      xty[r] = (xty[r] as number) + rowR * yi;
      const xtxR = xtx[r] as number[];
      for (let c = 0; c < k; c += 1) {
        xtxR[c] = (xtxR[c] as number) + rowR * (row[c] as number);
      }
    }
  }
  const aug: number[][] = xtx.map((rowVals, r) => {
    const arr = [...rowVals];
    arr.push(xty[r] as number);
    return arr;
  });
  // Gauss-Jordan elimination with partial pivoting.
  for (let col = 0; col < k; col += 1) {
    let pivot = col;
    let pivotMag = Math.abs((aug[col] as number[])[col] as number);
    for (let r = col + 1; r < k; r += 1) {
      const v = Math.abs((aug[r] as number[])[col] as number);
      if (v > pivotMag) {
        pivot = r;
        pivotMag = v;
      }
    }
    if (pivotMag < 1e-14) {
      // Singular — design matrix collinear. Return RSS of mean model.
      return totalSumOfSquares(y);
    }
    if (pivot !== col) {
      const tmp = aug[col] as number[];
      aug[col] = aug[pivot] as number[];
      aug[pivot] = tmp;
    }
    const pivRow = aug[col] as number[];
    const pivVal = pivRow[col] as number;
    for (let c = col; c <= k; c += 1) {
      pivRow[c] = (pivRow[c] as number) / pivVal;
    }
    for (let r = 0; r < k; r += 1) {
      if (r === col) continue;
      const factor = (aug[r] as number[])[col] as number;
      if (factor === 0) continue;
      const rRow = aug[r] as number[];
      for (let c = col; c <= k; c += 1) {
        rRow[c] = (rRow[c] as number) - factor * (pivRow[c] as number);
      }
    }
  }
  const beta: number[] = aug.map((row) => row[k] as number);
  let rss = 0;
  for (let i = 0; i < n; i += 1) {
    const row = designRows[i] as ReadonlyArray<number>;
    let yhat = 0;
    for (let r = 0; r < k; r += 1) {
      yhat += (beta[r] as number) * (row[r] as number);
    }
    const e = (y[i] as number) - yhat;
    rss += e * e;
  }
  return rss;
}

function totalSumOfSquares(y: ReadonlyArray<number>): number {
  if (y.length === 0) return 0;
  let mean = 0;
  for (const v of y) mean += v;
  mean /= y.length;
  let s = 0;
  for (const v of y) s += (v - mean) * (v - mean);
  return s;
}

/**
 * Upper-tail CDF of the F(d1, d2) distribution at x via the
 * regularised incomplete beta function:
 *
 *   P(F >= x) = I_{d2 / (d2 + d1*x)}(d2/2, d1/2)
 *
 * Returns p in [0, 1].
 */
export function fDistributionUpperTail(
  x: number,
  d1: number,
  d2: number,
): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (d1 <= 0 || d2 <= 0) return 1;
  const t = d2 / (d2 + d1 * x);
  const clamped = Math.max(1e-12, Math.min(1 - 1e-12, t));
  return regularisedIncompleteBeta(clamped, d2 / 2, d1 / 2);
}

/**
 * Lentz's continued-fraction evaluation of the regularised incomplete
 * beta function I_x(a, b). Numerically stable for the F-distribution
 * range used here.
 */
function regularisedIncompleteBeta(
  x: number,
  a: number,
  b: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const eps = 3e-12;
  const maxIter = 200;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h;
}

function logGamma(z: number): number {
  // Lanczos approximation; standard coefficients.
  const g = 7;
  const coeffs = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  let x = coeffs[0] as number;
  for (let i = 1; i < g + 2; i += 1) {
    x += (coeffs[i] as number) / (z - 1 + i);
  }
  const t = z - 1 + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (z - 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}
