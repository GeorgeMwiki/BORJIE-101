/**
 * Sharp Regression Discontinuity (RD) estimator — pure TypeScript.
 *
 * In a sharp RD design, treatment assignment is a deterministic
 * step function of a running variable r at threshold c:
 *
 *   D_i = 1{r_i >= c}
 *
 * The estimand is the limit of E[Y | r] as r approaches c from
 * either side; the estimate is the jump:
 *
 *   tau_RD = lim_{r -> c+} E[Y | r] - lim_{r -> c-} E[Y | r]
 *
 * We estimate the two one-sided limits via local linear regression
 * within a bandwidth h on each side of c. Bandwidth defaults to the
 * Imbens-Kalyanaraman rule-of-thumb (h = std(r) * n^{-1/5}); the
 * caller can override.
 *
 * For Mr. Mwikila this answers: "did the new royalty threshold (e.g.
 * filings above 2 t/month) cause shipment delays?". The threshold is
 * the running variable; the jump in delay-days at the threshold is
 * the causal estimate.
 *
 * Reference: Cunningham, S. — Causal Inference: The Mixtape (2021),
 * Chapter 6.
 *
 * @module @borjie/causal-inference/estimate/regression-discontinuity
 */

import {
  CausalInferenceError,
  type TreatmentEffect,
} from '../types.js';
import { inverseStandardNormalCdf } from './diff-in-diff.js';

export interface RdObservation {
  /** Running variable. */
  readonly running: number;
  /** Outcome. */
  readonly outcome: number;
}

export interface RdOptions {
  /** Threshold value c. Default 0. */
  readonly threshold?: number;
  /** Bandwidth h on each side. Default rule-of-thumb. */
  readonly bandwidth?: number;
  /** Significance level for CI. Default 0.05. */
  readonly alpha?: number;
  readonly treatmentLabel?: string;
  readonly outcomeLabel?: string;
}

export function regressionDiscontinuity(
  observations: ReadonlyArray<RdObservation>,
  options: RdOptions = {},
): TreatmentEffect {
  if (observations.length < 6) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      `rd: need at least 6 observations, got ${observations.length}`,
    );
  }
  const c = options.threshold ?? 0;
  const h = options.bandwidth ?? ruleOfThumbBandwidth(observations);
  const alpha = options.alpha ?? 0.05;

  const left: RdObservation[] = [];
  const right: RdObservation[] = [];
  for (const o of observations) {
    if (o.running >= c - h && o.running < c) left.push(o);
    else if (o.running >= c && o.running <= c + h) right.push(o);
  }
  if (left.length < 2 || right.length < 2) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      `rd: need >= 2 observations on each side of threshold within bandwidth h=${h}; got left=${left.length}, right=${right.length}`,
    );
  }

  const leftFit = localLinearFit(left, c);
  const rightFit = localLinearFit(right, c);
  const tau = rightFit.intercept - leftFit.intercept;
  const variance = rightFit.varIntercept + leftFit.varIntercept;
  const se = Math.sqrt(Math.max(0, variance));
  const z = inverseStandardNormalCdf(1 - alpha / 2);
  const ciHalf = z * se;
  return Object.freeze({
    treatment: options.treatmentLabel ?? 'above_threshold',
    outcome: options.outcomeLabel ?? 'outcome',
    identification: 'rd',
    estimate: tau,
    ciLow: tau - ciHalf,
    ciHigh: tau + ciHalf,
    standardError: se,
    sampleSize: left.length + right.length,
  });
}

interface LocalFit {
  readonly intercept: number;
  readonly slope: number;
  readonly varIntercept: number;
}

/**
 * OLS of Y on (1, r - c) over the supplied bandwidth window. The
 * intercept of this regression equals the limit of E[Y | r] at r = c.
 */
function localLinearFit(obs: ReadonlyArray<RdObservation>, c: number): LocalFit {
  const n = obs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const o of obs) {
    const x = o.running - c;
    sx += x;
    sy += o.outcome;
    sxx += x * x;
    sxy += x * o.outcome;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  const denom = sxx - sx * sx / n;
  const slope = denom === 0 ? 0 : (sxy - sx * sy / n) / denom;
  const intercept = meanY - slope * meanX;
  // Residuals and SE of the intercept.
  let rss = 0;
  for (const o of obs) {
    const x = o.running - c;
    const yhat = intercept + slope * x;
    const e = o.outcome - yhat;
    rss += e * e;
  }
  const dof = Math.max(1, n - 2);
  const sigma2 = rss / dof;
  // var(intercept) = sigma2 * (1/n + meanX^2 / Sxx_centered).
  const sxxCentered = denom; // Sum (x - mean)^2
  const varIntercept =
    sigma2 * (1 / n + (meanX * meanX) / Math.max(sxxCentered, 1e-12));
  return { intercept, slope, varIntercept };
}

function ruleOfThumbBandwidth(
  obs: ReadonlyArray<RdObservation>,
): number {
  const n = obs.length;
  let mean = 0;
  for (const o of obs) mean += o.running;
  mean /= n;
  let v = 0;
  for (const o of obs) v += (o.running - mean) * (o.running - mean);
  const std = Math.sqrt(v / Math.max(1, n - 1));
  // Standard IK rule-of-thumb scaling factor.
  return Math.max(1e-6, std * Math.pow(n, -1 / 5));
}
