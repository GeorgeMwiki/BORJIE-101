/**
 * Online stream wrapper.
 *
 * Wraps a *batch* score-based detector with a sliding window and a
 * refit schedule. The contract is intentionally minimal: feed an
 * `(x, t)` observation; the wrapper appends to the window, refits on
 * the warm window every `refitEvery` steps, scores `x`, and returns
 * the result plus the new state.
 *
 * Design follows the River library's anomaly-detection conventions
 * (https://riverml.xyz/0.21.0/api/anomaly/) but stays drizzle-free
 * and dependency-free.
 *
 * State is immutable: every update returns a new state object so
 * callers can persist between observations.
 *
 * @module @borjie/anomaly-detection/online/stream-detector
 */

import { fitMad, scoreMad } from '../detectors/mad-threshold.js';
import { fitZScore, scoreZ } from '../detectors/zscore-threshold.js';
import type { AnomalyScore, StreamDetectorConfig } from '../types.js';

const DEFAULT_WARMUP = 64;
const DEFAULT_MAX_WINDOW = 1024;
const DEFAULT_REFIT_EVERY = 256;

export type UnivariateDetectorKind = 'zscore' | 'mad';

export interface UnivariateStreamState {
  readonly detectorKind: UnivariateDetectorKind;
  readonly window: ReadonlyArray<number>;
  readonly warmup: number;
  readonly maxWindow: number;
  readonly refitEvery: number;
  readonly stepsSinceRefit: number;
  readonly samples: number;
}

export function createUnivariateStreamState(
  detectorKind: UnivariateDetectorKind,
  config: StreamDetectorConfig = {},
): UnivariateStreamState {
  return Object.freeze({
    detectorKind,
    window: [],
    warmup: config.warmup ?? DEFAULT_WARMUP,
    maxWindow: config.maxWindow ?? DEFAULT_MAX_WINDOW,
    refitEvery: config.refitEvery ?? DEFAULT_REFIT_EVERY,
    stepsSinceRefit: 0,
    samples: 0,
  });
}

export interface StreamStep {
  readonly state: UnivariateStreamState;
  readonly score: AnomalyScore | null;
  readonly warm: boolean;
}

/**
 * Feed one observation. While the window is below `warmup` we emit
 * `score = null` and `warm = false`; otherwise we score against the
 * current window using the configured detector.
 */
export function pushUnivariate(
  state: UnivariateStreamState,
  value: number,
): StreamStep {
  const window =
    state.window.length >= state.maxWindow
      ? [...state.window.slice(1), value]
      : [...state.window, value];
  const samples = state.samples + 1;
  const stepsSinceRefit = (state.stepsSinceRefit + 1) % Math.max(1, state.refitEvery);

  const newState: UnivariateStreamState = Object.freeze({
    detectorKind: state.detectorKind,
    window,
    warmup: state.warmup,
    maxWindow: state.maxWindow,
    refitEvery: state.refitEvery,
    stepsSinceRefit,
    samples,
  });

  if (window.length < state.warmup) {
    return Object.freeze({ state: newState, score: null, warm: false });
  }

  // For threshold detectors the "fit" is cheap, so we refit on every
  // step; `refitEvery` is exposed for parity with heavier detectors
  // wired in via future strategy adapters.
  let score: AnomalyScore;
  if (state.detectorKind === 'zscore') {
    score = scoreZ(value, fitZScore(window));
  } else {
    score = scoreMad(value, fitMad(window));
  }

  return Object.freeze({ state: newState, score, warm: true });
}
