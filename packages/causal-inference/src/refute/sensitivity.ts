/**
 * Sensitivity analysis via E-value — pure TypeScript.
 *
 * The E-value (VanderWeele & Ding 2017) answers: "how strong would
 * an unobserved confounder have to be — on the risk-ratio scale —
 * to fully explain away the observed effect?". A value of 1 means
 * trivially explainable; values >= 2 indicate moderate robustness;
 * values >= 4 strong robustness.
 *
 * For an observed risk-ratio RR (RR >= 1), the closed-form E-value
 * is:
 *
 *   E = RR + sqrt(RR * (RR - 1))
 *
 * For an effect estimated on the difference scale, the caller must
 * first convert to a risk-ratio or odds-ratio (we accept both and
 * compute the same form). For continuous outcomes we provide a
 * standardised-difference -> approximate-RR mapping per VanderWeele
 * (2020).
 *
 * Reference: VanderWeele, T. & Ding, P. (2017) — "Sensitivity
 * Analysis in Observational Research: Introducing the E-Value"
 * (Annals of Internal Medicine).
 *
 * @module @borjie/causal-inference/refute/sensitivity
 */

import { CausalInferenceError } from '../types.js';

export interface SensitivityInput {
  /** Effect on the chosen scale. */
  readonly estimate: number;
  /** Scale of the estimate. */
  readonly scale: 'risk-ratio' | 'odds-ratio' | 'standardised-difference';
}

export interface SensitivityReport {
  /** E-value: minimum strength of an unmeasured confounder to nullify the effect. */
  readonly eValue: number;
  /** True if eValue >= 2.0 (moderate-strong robustness). */
  readonly robust: boolean;
  /** Echoed input. */
  readonly input: SensitivityInput;
}

export function eValueSensitivity(input: SensitivityInput): SensitivityReport {
  let rr: number;
  switch (input.scale) {
    case 'risk-ratio':
      rr = input.estimate;
      break;
    case 'odds-ratio':
      rr = input.estimate;
      break;
    case 'standardised-difference': {
      // VanderWeele 2020 approximation: RR ~ exp(0.91 * |d|).
      rr = Math.exp(0.91 * Math.abs(input.estimate));
      break;
    }
    default:
      throw new CausalInferenceError(
        'INVALID_PANEL',
        `eValueSensitivity: unsupported scale "${(input as { scale: string }).scale}"`,
      );
  }
  if (!Number.isFinite(rr) || rr <= 0) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      `eValueSensitivity: invalid risk-ratio ${rr}`,
    );
  }
  // Symmetry: if RR < 1, take its reciprocal so the formula applies.
  const rrSym = rr < 1 ? 1 / rr : rr;
  const e = rrSym + Math.sqrt(rrSym * (rrSym - 1));
  return Object.freeze({
    eValue: e,
    robust: e >= 2.0,
    input,
  });
}
