/**
 * Synthetic Control estimator — pure TypeScript.
 *
 * Abadie (2021): the treated unit's counterfactual is a convex
 * combination of donor units that best matches the treated unit's
 * pre-treatment outcome path. The convex weights w_i satisfy:
 *
 *   w_i >= 0  for all i
 *   sum_i w_i = 1
 *   minimise || Y_T,pre - sum_i w_i * Y_i,pre ||_2
 *
 * The treatment effect at each post-period t is:
 *
 *   tau_t = Y_T,post(t) - sum_i w_i * Y_i,post(t)
 *
 * We solve the constrained quadratic program via projected gradient
 * descent with simplex projection (Duchi et al. 2008). Pure TS;
 * deterministic; no external dependency.
 *
 * For Mr. Mwikila: "did the new royalty schedule cause filing
 * delays?" — treated unit = our jurisdiction, donor pool = comparable
 * jurisdictions. The estimator returns the average post-period gap
 * as the headline causal effect and a per-period gap series for
 * diagnostic plots.
 *
 * Reference: Abadie, A. "Using Synthetic Controls: Feasibility, Data
 * Requirements, and Methodological Aspects". Journal of Economic
 * Literature, 59(2), 2021.
 *
 * @module @borjie/causal-inference/estimate/synthetic-control
 */

import {
  CausalInferenceError,
  type TreatmentEffect,
} from '../types.js';

export interface SyntheticControlInput {
  /** Pre-treatment outcomes for the treated unit, time-ordered. */
  readonly treatedPre: ReadonlyArray<number>;
  /** Pre-treatment outcomes for each donor; each row time-aligned with `treatedPre`. */
  readonly donorPre: ReadonlyArray<ReadonlyArray<number>>;
  /** Post-treatment outcomes for the treated unit, time-ordered. */
  readonly treatedPost: ReadonlyArray<number>;
  /** Post-treatment outcomes for each donor; each row time-aligned with `treatedPost`. */
  readonly donorPost: ReadonlyArray<ReadonlyArray<number>>;
}

export interface SyntheticControlOptions {
  /** Maximum projected-gradient iterations. Default 5000. */
  readonly maxIterations?: number;
  /** Convergence tolerance on the loss. Default 1e-9. */
  readonly tolerance?: number;
  /** Step size for projected gradient. Default auto from Lipschitz bound. */
  readonly stepSize?: number;
  /** Override treatment label. */
  readonly treatmentLabel?: string;
  /** Override outcome label. */
  readonly outcomeLabel?: string;
}

export interface SyntheticControlResult extends TreatmentEffect {
  /** Convex weights, one per donor, summing to 1. */
  readonly weights: ReadonlyArray<number>;
  /** Per-period post-treatment gap (treated minus synthetic). */
  readonly gapSeries: ReadonlyArray<number>;
  /** Pre-treatment RMSE achieved by the synthetic control. */
  readonly preRmse: number;
}

export function syntheticControl(
  input: SyntheticControlInput,
  options: SyntheticControlOptions = {},
): SyntheticControlResult {
  validateInput(input);
  const numDonors = input.donorPre.length;
  const preLen = input.treatedPre.length;
  const maxIter = options.maxIterations ?? 5000;
  const tol = options.tolerance ?? 1e-9;

  // Initialise weights uniformly on the simplex.
  let w: number[] = new Array(numDonors).fill(1 / numDonors) as number[];
  let prevLoss = computeLoss(input.treatedPre, input.donorPre, w);

  // Estimate Lipschitz constant for step-size if not provided.
  const lipschitz = estimateLipschitz(input.donorPre);
  const step = options.stepSize ?? 1 / Math.max(1e-6, lipschitz);

  for (let iter = 0; iter < maxIter; iter += 1) {
    const grad = computeGradient(input.treatedPre, input.donorPre, w);
    const next: number[] = w.map((wi, i) => wi - step * (grad[i] as number));
    const projected = projectOntoSimplex(next);
    const loss = computeLoss(input.treatedPre, input.donorPre, projected);
    w = projected;
    if (Math.abs(prevLoss - loss) < tol) break;
    prevLoss = loss;
  }

  // Compute per-period post gap and headline ATE.
  const postLen = input.treatedPost.length;
  const gap: number[] = new Array(postLen).fill(0) as number[];
  for (let t = 0; t < postLen; t += 1) {
    let synthetic = 0;
    for (let i = 0; i < numDonors; i += 1) {
      synthetic +=
        (w[i] as number) * (input.donorPost[i] as ReadonlyArray<number>)[t]!;
    }
    gap[t] = (input.treatedPost[t] as number) - synthetic;
  }
  const ate =
    gap.length === 0
      ? 0
      : gap.reduce((s, v) => s + v, 0) / gap.length;

  // Pre-period RMSE.
  let preSse = 0;
  for (let t = 0; t < preLen; t += 1) {
    let synthetic = 0;
    for (let i = 0; i < numDonors; i += 1) {
      synthetic +=
        (w[i] as number) * (input.donorPre[i] as ReadonlyArray<number>)[t]!;
    }
    const e = (input.treatedPre[t] as number) - synthetic;
    preSse += e * e;
  }
  const preRmse = Math.sqrt(preSse / Math.max(1, preLen));

  // CI via post-period gap variance: classical t-style with n = postLen.
  let gapMean = 0;
  for (const g of gap) gapMean += g;
  gapMean /= Math.max(1, gap.length);
  let gapVar = 0;
  for (const g of gap) gapVar += (g - gapMean) * (g - gapMean);
  gapVar /= Math.max(1, gap.length - 1);
  const gapSe = Math.sqrt(gapVar / Math.max(1, gap.length));
  const ciHalf = 1.96 * gapSe;

  return Object.freeze({
    treatment: options.treatmentLabel ?? 'treated',
    outcome: options.outcomeLabel ?? 'outcome',
    identification: 'synthetic-control',
    estimate: ate,
    ciLow: ate - ciHalf,
    ciHigh: ate + ciHalf,
    standardError: gapSe,
    sampleSize: preLen + postLen,
    weights: Object.freeze(w.slice()),
    gapSeries: Object.freeze(gap.slice()),
    preRmse,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateInput(input: SyntheticControlInput): void {
  if (input.donorPre.length === 0) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      'synthetic-control: empty donor pool',
    );
  }
  if (input.donorPre.length !== input.donorPost.length) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      'synthetic-control: donorPre and donorPost must have equal donor count',
    );
  }
  const preLen = input.treatedPre.length;
  if (preLen < 2) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      'synthetic-control: need >= 2 pre-treatment periods',
    );
  }
  for (const dp of input.donorPre) {
    if (dp.length !== preLen) {
      throw new CausalInferenceError(
        'INVALID_PANEL',
        'synthetic-control: every donor row must match treatedPre length',
      );
    }
  }
  const postLen = input.treatedPost.length;
  if (postLen < 1) {
    throw new CausalInferenceError(
      'INSUFFICIENT_DATA',
      'synthetic-control: need >= 1 post-treatment period',
    );
  }
  for (const dp of input.donorPost) {
    if (dp.length !== postLen) {
      throw new CausalInferenceError(
        'INVALID_PANEL',
        'synthetic-control: every donor row must match treatedPost length',
      );
    }
  }
}

function computeLoss(
  treatedPre: ReadonlyArray<number>,
  donorPre: ReadonlyArray<ReadonlyArray<number>>,
  weights: ReadonlyArray<number>,
): number {
  let loss = 0;
  for (let t = 0; t < treatedPre.length; t += 1) {
    let synthetic = 0;
    for (let i = 0; i < donorPre.length; i += 1) {
      synthetic +=
        (weights[i] as number) *
        ((donorPre[i] as ReadonlyArray<number>)[t] as number);
    }
    const e = (treatedPre[t] as number) - synthetic;
    loss += e * e;
  }
  return loss;
}

function computeGradient(
  treatedPre: ReadonlyArray<number>,
  donorPre: ReadonlyArray<ReadonlyArray<number>>,
  weights: ReadonlyArray<number>,
): number[] {
  const grad: number[] = new Array(weights.length).fill(0) as number[];
  for (let t = 0; t < treatedPre.length; t += 1) {
    let synthetic = 0;
    for (let i = 0; i < donorPre.length; i += 1) {
      synthetic +=
        (weights[i] as number) *
        ((donorPre[i] as ReadonlyArray<number>)[t] as number);
    }
    const r = synthetic - (treatedPre[t] as number);
    for (let i = 0; i < donorPre.length; i += 1) {
      grad[i] =
        (grad[i] as number) +
        2 * r * ((donorPre[i] as ReadonlyArray<number>)[t] as number);
    }
  }
  return grad;
}

function estimateLipschitz(
  donorPre: ReadonlyArray<ReadonlyArray<number>>,
): number {
  // Upper bound via Frobenius norm of D'D where D is the donor matrix.
  let frob = 0;
  for (const row of donorPre) {
    for (const v of row) frob += v * v;
  }
  return Math.max(1, 2 * frob);
}

/**
 * Project vector `v` onto the probability simplex
 * { w : w_i >= 0, sum_i w_i = 1 } via the O(n log n) sort-based
 * algorithm of Duchi et al. (2008).
 */
export function projectOntoSimplex(v: ReadonlyArray<number>): number[] {
  const n = v.length;
  if (n === 0) return [];
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = 0;
  for (let i = 0; i < n; i += 1) {
    cssv += u[i] as number;
    const threshold = (cssv - 1) / (i + 1);
    if ((u[i] as number) - threshold > 0) rho = i;
  }
  let cssvRho = 0;
  for (let i = 0; i <= rho; i += 1) cssvRho += u[i] as number;
  const theta = (cssvRho - 1) / (rho + 1);
  return v.map((vi) => Math.max(0, vi - theta));
}
