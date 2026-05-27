/**
 * Page-Hinkley drift detector.
 *
 * Pure-TypeScript port of Page, E. S. (1954). *Continuous Inspection
 * Schemes.* Biometrika 41(1/2):100-115. DOI: 10.2307/2333009.
 *
 * Mechanism (one-sided, mean-increase variant):
 *
 *   x̂_t = running mean of observations
 *   m_t  = m_{t-1} + (x_t − x̂_t − δ)
 *   M_t  = min(M_{t-1}, m_t)
 *   PH_t = m_t − M_t
 *   drift when PH_t > λ
 *
 * The forgetting factor α ∈ (0, 1] applies to the running mean
 * (α = 1 = no forgetting, equivalent to plain online mean).
 *
 * We detect mean shifts in **either** direction by tracking both the
 * upper (`PH+`) and lower (`PH−`) cumulative-sums and reporting drift
 * when the larger of the two exceeds λ.
 *
 * @module @borjie/anomaly-detection/drift/page-hinkley
 */

import type { DriftSignal, PageHinkleyConfig } from '../types.js';

const DEFAULT_DELTA = 0.005;
const DEFAULT_THRESHOLD = 50;
const DEFAULT_ALPHA = 1;

export interface PageHinkleyState {
  readonly mean: number;
  readonly samples: number;
  readonly mPos: number;
  readonly mNeg: number;
  readonly minPos: number;
  readonly maxNeg: number;
  readonly delta: number;
  readonly threshold: number;
  readonly alpha: number;
}

export function createPageHinkleyState(
  config: PageHinkleyConfig = {},
): PageHinkleyState {
  return Object.freeze({
    mean: 0,
    samples: 0,
    mPos: 0,
    mNeg: 0,
    minPos: 0,
    maxNeg: 0,
    delta: config.delta ?? DEFAULT_DELTA,
    threshold: config.threshold ?? DEFAULT_THRESHOLD,
    alpha: config.alpha ?? DEFAULT_ALPHA,
  });
}

export function updatePageHinkley(
  state: PageHinkleyState,
  value: number,
): { readonly state: PageHinkleyState; readonly signal: DriftSignal } {
  const samples = state.samples + 1;
  // Forgetting-aware running mean.
  const newMean =
    state.alpha >= 1
      ? state.mean + (value - state.mean) / samples
      : state.alpha * state.mean + (1 - state.alpha) * value;

  // Upper (mean-increase) cumulative-sum.
  const mPos = state.mPos + (value - newMean - state.delta);
  const minPos = Math.min(state.minPos, mPos);
  const phPos = mPos - minPos;

  // Lower (mean-decrease) cumulative-sum.
  const mNeg = state.mNeg + (value - newMean + state.delta);
  const maxNeg = Math.max(state.maxNeg, mNeg);
  const phNeg = maxNeg - mNeg;

  const statistic = Math.max(phPos, phNeg);
  const driftDetected = statistic > state.threshold;

  const newState: PageHinkleyState = Object.freeze({
    mean: newMean,
    samples,
    mPos,
    mNeg,
    minPos,
    maxNeg,
    delta: state.delta,
    threshold: state.threshold,
    alpha: state.alpha,
  });

  const signal: DriftSignal = Object.freeze({
    kind: 'page-hinkley' as const,
    driftDetected,
    statistic,
    threshold: state.threshold,
    samples,
  });
  return { state: newState, signal };
}
