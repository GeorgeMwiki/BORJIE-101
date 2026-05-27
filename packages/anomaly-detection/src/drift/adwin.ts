/**
 * ADWIN — Adaptive Windowing concept-drift detector.
 *
 * Pure-TypeScript port of Bifet, A. & Gavaldà, R. (2007).
 * *Learning from Time-Changing Data with Adaptive Windowing.*
 * SDM 2007. DOI: 10.1137/1.9781611972771.42.
 *
 * Implementation choice — we use the **simple sliding-history** form
 * (the "ADWIN0" baseline in the paper) rather than the bucketed
 * exponential-histogram optimisation. For our typical Mr. Mwikila
 * stream lengths (~1k-10k events per asset per day) the simple form
 * is more than fast enough and stays easy to reason about. The cut
 * criterion is identical:
 *
 *   ε_cut = sqrt( (1 / (2 m)) · ln(4 |W| / δ) )
 *
 *   where m = harmonic_mean(|W_0|, |W_1|) / 2
 *
 * Drift is declared when there exists a cut-point (W_0, W_1) such
 * that |mean(W_0) − mean(W_1)| > ε_cut. The detector then drops W_0
 * from its window and resumes from W_1.
 *
 * The state is **immutable**: every update returns a new state
 * struct. This matches the rest of the package and lets callers
 * persist state between observations.
 *
 * @module @borjie/anomaly-detection/drift/adwin
 */

import type { AdwinConfig, DriftSignal } from '../types.js';

const DEFAULT_DELTA = 0.002;
const DEFAULT_MIN_WINDOW = 5;

export interface AdwinState {
  readonly window: ReadonlyArray<number>;
  readonly delta: number;
  readonly minWindow: number;
  readonly samples: number;
}

export function createAdwinState(config: AdwinConfig = {}): AdwinState {
  return Object.freeze({
    window: [],
    delta: config.delta ?? DEFAULT_DELTA,
    minWindow: config.minWindow ?? DEFAULT_MIN_WINDOW,
    samples: 0,
  });
}

function harmonicMean(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return (2 * a * b) / (a + b);
}

function epsilonCut(
  n0: number,
  n1: number,
  totalLen: number,
  delta: number,
): number {
  const m = harmonicMean(n0, n1) / 2;
  if (m <= 0) return Infinity;
  return Math.sqrt((1 / (2 * m)) * Math.log((4 * totalLen) / delta));
}

function meanOf(values: ReadonlyArray<number>, start: number, end: number): number {
  let s = 0;
  for (let i = start; i < end; i += 1) s += values[i]!;
  return s / (end - start);
}

/**
 * Update ADWIN with one observation. Returns the **new** state and
 * the drift signal at this step.
 */
export function updateAdwin(
  state: AdwinState,
  value: number,
): { readonly state: AdwinState; readonly signal: DriftSignal } {
  const next = [...state.window, value];
  const samples = state.samples + 1;
  const W = next.length;
  let driftDetected = false;
  let bestStat = 0;
  let bestThreshold = 0;
  let cutAt = -1;

  if (W >= 2 * state.minWindow) {
    for (let split = state.minWindow; split <= W - state.minWindow; split += 1) {
      const mean0 = meanOf(next, 0, split);
      const mean1 = meanOf(next, split, W);
      const diff = Math.abs(mean0 - mean1);
      const eps = epsilonCut(split, W - split, W, state.delta);
      if (diff > eps) {
        driftDetected = true;
        if (diff - eps > bestStat - bestThreshold) {
          bestStat = diff;
          bestThreshold = eps;
          cutAt = split;
        }
      }
    }
  }

  const newWindow = driftDetected && cutAt >= 0 ? next.slice(cutAt) : next;

  const newState: AdwinState = Object.freeze({
    window: newWindow,
    delta: state.delta,
    minWindow: state.minWindow,
    samples,
  });

  const signal: DriftSignal = Object.freeze({
    kind: 'adwin' as const,
    driftDetected,
    statistic: bestStat,
    threshold: bestThreshold,
    samples,
  });
  return { state: newState, signal };
}
