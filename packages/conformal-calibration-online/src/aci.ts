/**
 * Adaptive Conformal Inference (ACI) — Gibbs & Candès 2021.
 *
 * Pure state machine. Caller persists the state and feeds back
 * coverage observations. Used in BORJIE forecasting (rent
 * collection, vacancy, maintenance cost) where shocks like FX
 * realignment, harvest-season cashflow swings, or election-season
 * vacancy spikes make a frozen alpha=0.05 over- or under-reject.
 *
 * Update rule:
 *
 *   alpha_t+1 = alpha_t + learning_rate * (observed_coverage - target_coverage)
 *
 * Note the sign: when observed_coverage < target_coverage (intervals
 * are too narrow), alpha must DECREASE so intervals get wider. So
 * gradient = (observed - target), and alpha moves with that gradient.
 *
 * Reference: Gibbs & Candès 2021 + Adaptive Conformal Inference for
 * Distribution Shift (arXiv 2511.15838).
 *
 * Companion: `conformalThresholdFromSorted` — quantile selection on a
 * pre-sorted calibration score vector. Re-implemented locally to keep
 * this package self-contained; future integration may delegate to
 * `packages/forecasting-engine`.
 */

import type {
  ConformalDiagnostic,
  CoverageObservation,
  OnlineConformalConfig,
  OnlineConformalState,
} from "./types.js";

const DEFAULT_TARGET_COVERAGE = 0.9;
const DEFAULT_INITIAL_ALPHA = 0.1;
const DEFAULT_LEARNING_RATE = 0.05;
const DEFAULT_WINDOW_SIZE = 200;
const DEFAULT_ALPHA_MIN = 0.01;
const DEFAULT_ALPHA_MAX = 0.5;
const DEFAULT_DRIFT_THRESHOLD = 0.05;
const DEFAULT_DRIFT_MIN_WINDOW = 30;

/**
 * Initialise a new online conformal state.
 */
export function createOnlineConformalState(
  config: OnlineConformalConfig = {},
): OnlineConformalState {
  return {
    targetCoverage: config.targetCoverage ?? DEFAULT_TARGET_COVERAGE,
    alpha: config.initialAlpha ?? DEFAULT_INITIAL_ALPHA,
    learningRate: config.learningRate ?? DEFAULT_LEARNING_RATE,
    windowSize: config.windowSize ?? DEFAULT_WINDOW_SIZE,
    recent: [],
  };
}

export interface UpdateOptions {
  /** Floor for alpha. Default 0.01. */
  readonly alphaMin?: number;
  /** Ceiling for alpha. Default 0.5. */
  readonly alphaMax?: number;
}

/**
 * Apply a single coverage observation. Returns the next state —
 * caller must persist it. Pure function; the input state is never
 * mutated.
 */
export function updateConformal(
  state: OnlineConformalState,
  observation: CoverageObservation,
  options: UpdateOptions = {},
): OnlineConformalState {
  const recent = [...state.recent, observation];
  while (recent.length > state.windowSize) recent.shift();
  const observedCoverage =
    recent.length === 0
      ? state.targetCoverage
      : recent.filter((o) => o.predictedCovered).length / recent.length;
  const alphaMin = options.alphaMin ?? DEFAULT_ALPHA_MIN;
  const alphaMax = options.alphaMax ?? DEFAULT_ALPHA_MAX;
  // alpha moves UP when coverage is too high (we're too cautious —
  // intervals too wide, reject less so they get tighter).
  // alpha moves DOWN when coverage is too low (intervals too narrow —
  // reject more so they widen).
  // gradient = observed - target. positive when over-covered, push
  // alpha up.
  const gradient = observedCoverage - state.targetCoverage;
  const proposed = state.alpha + state.learningRate * gradient;
  const alpha = Math.max(alphaMin, Math.min(alphaMax, proposed));
  return { ...state, alpha, recent };
}

/**
 * Bulk apply — fold many observations through the state machine.
 * Useful for back-filling history.
 */
export function applyBatch(
  state: OnlineConformalState,
  observations: ReadonlyArray<CoverageObservation>,
  options: UpdateOptions = {},
): OnlineConformalState {
  let next = state;
  for (const o of observations) next = updateConformal(next, o, options);
  return next;
}

/**
 * Current alpha. Caller uses this to set the conformal rejection cut
 * on the next prediction.
 */
export function currentAlpha(state: OnlineConformalState): number {
  return state.alpha;
}

/**
 * Diagnostic snapshot — for admin dashboards / audit logs.
 */
export function diagnostic(
  state: OnlineConformalState,
  options: {
    readonly driftThreshold?: number;
    readonly driftMinWindow?: number;
  } = {},
): ConformalDiagnostic {
  const observedCoverage =
    state.recent.length === 0
      ? state.targetCoverage
      : state.recent.filter((o) => o.predictedCovered).length /
        state.recent.length;
  const driftThreshold = options.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;
  const driftMinWindow = options.driftMinWindow ?? DEFAULT_DRIFT_MIN_WINDOW;
  const drift = Math.abs(observedCoverage - state.targetCoverage);
  return {
    alpha: state.alpha,
    targetCoverage: state.targetCoverage,
    observedCoverage,
    windowFilled: state.recent.length,
    drifting:
      drift > driftThreshold && state.recent.length >= driftMinWindow,
  };
}

/**
 * Compute the conformal threshold on a pre-sorted calibration score
 * vector at the current alpha. The score must already be in
 * ascending order. Returns +Infinity when no scores are present —
 * the caller's downstream rejection check should then admit
 * everything.
 *
 * Finite-sample quantile per Vovk et al.:
 *   q = ceil((n + 1) * (1 - alpha)) / n
 */
export function conformalThresholdAt(
  state: OnlineConformalState,
  sortedCalibrationScores: ReadonlyArray<number>,
): number {
  const n = sortedCalibrationScores.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  const q = Math.ceil((n + 1) * (1 - state.alpha)) / n;
  const clamped = Math.min(1, Math.max(0, q));
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(clamped * n) - 1));
  return sortedCalibrationScores[idx];
}
