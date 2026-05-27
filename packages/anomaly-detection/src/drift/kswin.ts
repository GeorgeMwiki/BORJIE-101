/**
 * KSWIN — Kolmogorov-Smirnov Windowing drift detector.
 *
 * Pure-TypeScript port of Raab, C., Heusinger, M. & Schleif, F.-M.
 * (2020). *Reactive Soft Prototype Computing for Concept Drift
 * Streams.* Neurocomputing 416:340-351.
 * DOI: 10.1016/j.neucom.2019.11.111.
 *
 * Mechanism: maintain a `reference` window (the oldest n samples) and
 * a `recent` window (the latest n samples). On every step, run a
 * two-sample KS test on the two windows; declare drift when
 * `D > D_critical(α)` where
 *
 *   D_critical(α) = sqrt( -ln(α / 2) · (n + n) / (2 · n · n) )
 *
 * (the canonical two-sample asymptotic critical value).
 *
 * Determinism: the test is fully deterministic given inputs. No PRNG
 * needed.
 *
 * @module @borjie/anomaly-detection/drift/kswin
 */

import type { DriftSignal, KswinConfig } from '../types.js';

const DEFAULT_WINDOW_SIZE = 100;
const DEFAULT_ALPHA = 0.005;

export interface KswinState {
  readonly buffer: ReadonlyArray<number>;
  readonly windowSize: number;
  readonly alpha: number;
  readonly samples: number;
}

export function createKswinState(config: KswinConfig = {}): KswinState {
  return Object.freeze({
    buffer: [],
    windowSize: config.windowSize ?? DEFAULT_WINDOW_SIZE,
    alpha: config.alpha ?? DEFAULT_ALPHA,
    samples: 0,
  });
}

function ksStatistic(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  // Two-sample KS — empirical CDF max gap.
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  const nA = sortedA.length;
  const nB = sortedB.length;
  while (i < nA && j < nB) {
    if (sortedA[i]! <= sortedB[j]!) {
      i += 1;
    } else {
      j += 1;
    }
    const gap = Math.abs(i / nA - j / nB);
    if (gap > d) d = gap;
  }
  return d;
}

function ksCritical(n: number, alpha: number): number {
  // Two-sample asymptotic critical value: D = sqrt(-0.5 ln(α/2)) · sqrt((n+n)/(n·n))
  return Math.sqrt(-Math.log(alpha / 2) * (2 / n));
}

/**
 * Push one observation; returns new state + drift signal.
 *
 * Drift signalling begins once the buffer has reached 2 * windowSize
 * (so both reference and recent windows are full).
 */
export function updateKswin(
  state: KswinState,
  value: number,
): { readonly state: KswinState; readonly signal: DriftSignal } {
  const samples = state.samples + 1;
  const cap = 2 * state.windowSize;
  const buffer = state.buffer.length >= cap
    ? [...state.buffer.slice(1), value]
    : [...state.buffer, value];

  let driftDetected = false;
  let statistic = 0;
  let threshold = 0;
  if (buffer.length >= cap) {
    const reference = buffer.slice(0, state.windowSize);
    const recent = buffer.slice(state.windowSize);
    statistic = ksStatistic(reference, recent);
    threshold = ksCritical(state.windowSize, state.alpha);
    driftDetected = statistic > threshold;
  }

  const newState: KswinState = Object.freeze({
    buffer,
    windowSize: state.windowSize,
    alpha: state.alpha,
    samples,
  });
  const signal: DriftSignal = Object.freeze({
    kind: 'kswin' as const,
    driftDetected,
    statistic,
    threshold,
    samples,
  });
  return { state: newState, signal };
}
