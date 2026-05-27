/**
 * Differences-in-Differences (DiD) estimator — pure TypeScript.
 *
 * The canonical 2 x 2 (two groups: treated/control; two periods:
 * pre/post) DiD ATE is:
 *
 *   ATE = (Ybar_T,post - Ybar_T,pre) - (Ybar_C,post - Ybar_C,pre)
 *
 * Identifying assumption: PARALLEL TRENDS. In the absence of
 * treatment, the treated group's outcome would have evolved with the
 * same slope as the control group's. Borjie's design surfaces a
 * placebo refutation alongside every DiD estimate to probe this.
 *
 * Standard error is computed via cluster-robust OLS on the
 * regression form:
 *
 *   Y = beta0 + beta1 * treated + beta2 * post + beta3 * treated*post + e
 *
 * where beta3 is the DiD ATE and SE(beta3) comes from the
 * (X'X)^{-1} (X'OmegaX) (X'X)^{-1} sandwich. For the homoskedastic
 * 2 x 2 case the sandwich collapses to the classical OLS SE which is
 * what we report.
 *
 * For Mr. Mwikila the test oracle is Cunningham's Mixtape (2021)
 * Chapter 9 worked example: hand-computed ATE = 4 on a 4-cell panel.
 *
 * Reference: Cunningham, S. — Causal Inference: The Mixtape (2021),
 * Chapter 9.
 *
 * @module @borjie/causal-inference/estimate/diff-in-diff
 */

import {
  CausalInferenceError,
  type TreatmentEffect,
} from '../types.js';

export interface DiDObservation {
  /** Treatment group flag: true if unit is in the treated cohort. */
  readonly treated: boolean;
  /** Post-period flag: true if observation is in the post period. */
  readonly post: boolean;
  /** Outcome value. */
  readonly outcome: number;
}

export interface DiDOptions {
  /** Significance level for CI. Default 0.05 (95 % CI). */
  readonly alpha?: number;
  /** Override the treatment column label. Default "treated". */
  readonly treatmentLabel?: string;
  /** Override the outcome column label. Default "outcome". */
  readonly outcomeLabel?: string;
}

/**
 * Estimate the average treatment effect on the treated via DiD.
 *
 * Requires at least one observation in each of the four cells
 * (treated x post, treated x pre, control x post, control x pre).
 */
export function differencesInDifferences(
  observations: ReadonlyArray<DiDObservation>,
  options: DiDOptions = {},
): TreatmentEffect {
  if (observations.length < 4) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      `did: need at least 4 observations, got ${observations.length}`,
    );
  }
  let nTT = 0;
  let nTC = 0;
  let nCT = 0;
  let nCC = 0;
  let sTT = 0;
  let sTC = 0;
  let sCT = 0;
  let sCC = 0;
  for (const o of observations) {
    if (o.treated && o.post) {
      nTT += 1;
      sTT += o.outcome;
    } else if (o.treated && !o.post) {
      nTC += 1;
      sTC += o.outcome;
    } else if (!o.treated && o.post) {
      nCT += 1;
      sCT += o.outcome;
    } else {
      nCC += 1;
      sCC += o.outcome;
    }
  }
  if (nTT === 0 || nTC === 0 || nCT === 0 || nCC === 0) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      'did: each of the four cells (treated x post) must have >= 1 observation',
    );
  }
  const yTT = sTT / nTT;
  const yTC = sTC / nTC;
  const yCT = sCT / nCT;
  const yCC = sCC / nCC;
  const ate = yTT - yTC - (yCT - yCC);

  // Classical OLS SE for the interaction coefficient. With design
  // matrix columns [1, T, P, T*P] and balanced cells, the variance
  // of the interaction estimator equals sigma^2 * (1/nTT + 1/nTC +
  // 1/nCT + 1/nCC). We estimate sigma^2 from within-cell residual
  // variance (cell mean as fit).
  let rss = 0;
  for (const o of observations) {
    const cellMean = o.treated
      ? o.post
        ? yTT
        : yTC
      : o.post
        ? yCT
        : yCC;
    const e = o.outcome - cellMean;
    rss += e * e;
  }
  const dof = observations.length - 4;
  const sigma2 = dof > 0 ? rss / dof : 0;
  const variance =
    sigma2 * (1 / nTT + 1 / nTC + 1 / nCT + 1 / nCC);
  const se = Math.sqrt(Math.max(0, variance));
  const alpha = options.alpha ?? 0.05;
  const z = inverseStandardNormalCdf(1 - alpha / 2);
  const ciHalf = z * se;

  return Object.freeze({
    treatment: options.treatmentLabel ?? 'treated',
    outcome: options.outcomeLabel ?? 'outcome',
    identification: 'did',
    estimate: ate,
    ciLow: ate - ciHalf,
    ciHigh: ate + ciHalf,
    standardError: se,
    sampleSize: observations.length,
  });
}

// ---------------------------------------------------------------------------
// Internals — inverse-normal CDF (Acklam's algorithm)
// ---------------------------------------------------------------------------

/**
 * Acklam's rational approximation of the inverse standard normal
 * CDF, accurate to ~1e-9 over (0, 1).
 */
export function inverseStandardNormalCdf(p: number): number {
  if (p <= 0 || p >= 1 || !Number.isFinite(p)) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      `inverseStandardNormalCdf: p must be in (0, 1), got ${p}`,
    );
  }
  const a: ReadonlyArray<number> = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b: ReadonlyArray<number> = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c: ReadonlyArray<number> = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d: ReadonlyArray<number> = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return tailRational(q, c, d);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return centralRational(q, r, a, b);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -tailRational(q, c, d);
}

/**
 * Central-region rational approximation for Acklam's algorithm.
 *
 *   numerator   = (((((a0*r + a1)*r + a2)*r + a3)*r + a4)*r + a5) * q
 *   denominator = (((((b0*r + b1)*r + b2)*r + b3)*r + b4)*r + 1)
 */
function centralRational(
  q: number,
  r: number,
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const num =
    ((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r +
      (a[3] as number)) *
      r +
      (a[4] as number)) *
      r +
      (a[5] as number)) *
    q;
  const den =
    (((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r +
      (b[3] as number)) *
      r +
      (b[4] as number)) *
      r +
    1;
  return num / den;
}

/**
 * Tail-region rational approximation for Acklam's algorithm.
 *
 *   numerator   = (((((c0*q + c1)*q + c2)*q + c3)*q + c4)*q + c5)
 *   denominator = ((((d0*q + d1)*q + d2)*q + d3)*q + 1)
 */
function tailRational(
  q: number,
  c: ReadonlyArray<number>,
  d: ReadonlyArray<number>,
): number {
  const num =
    (((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q +
      (c[3] as number)) *
      q +
      (c[4] as number)) *
      q +
    (c[5] as number);
  const den =
    ((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q +
      (d[3] as number)) *
      q +
    1;
  return num / den;
}
