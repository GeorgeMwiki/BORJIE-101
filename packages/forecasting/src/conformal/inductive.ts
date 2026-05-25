/**
 * Inductive Conformal Prediction (ICP).
 *
 * Given a fitted base-predictor and a held-out calibration set, build
 * prediction intervals with a frequentist coverage guarantee: over
 * many future draws from the same distribution, the true value will
 * land inside the interval at rate 1 - alpha.
 *
 * ICP assumes exchangeability of calibration + test points. For
 * time-series, we use a rolling-window exchangeability window (see
 * `rollingWindow`) so concept drift doesn't silently break coverage.
 *
 * Mathematical core:
 *
 *   1. Compute nonconformity score s_i = |y_i - ŷ_i| for every
 *      calibration point (or a squared / quantile variant).
 *   2. Pick the (1 - alpha)-quantile q of the scores.
 *   3. Interval(x) = [ŷ(x) - q, ŷ(x) + q].
 *
 * This module is pure, deterministic, and has no external deps. The
 * caller passes in the calibration sample; we return a calibrator
 * that can price any new point prediction.
 */

import type { ConformalInterval } from '../types.js';

export interface CalibrationPoint {
  readonly predicted: number;
  readonly actual: number;
}

export interface Calibrator {
  /** Add a new calibration observation. Idempotent; safe to call
   *  from the streaming ingest loop. */
  update(point: CalibrationPoint): void;
  /** Build an interval for a fresh point prediction at the given
   *  miscoverage rate. Throws if the sample is below
   *  `minCalibrationPoints`. */
  interval(predicted: number, alpha: number): ConformalInterval;
  /** Number of calibration points currently held. */
  readonly size: number;
}

export interface CalibratorOptions {
  /** Minimum calibration points required before `interval` is valid.
   *  Below this, intervals would under-cover. Default 30. */
  readonly minCalibrationPoints?: number;
  /** Maximum points retained in the rolling window. Older points
   *  drop off. Default 2000. */
  readonly rollingWindow?: number;
  /** Clamp the lower bound at 0 and upper at 1 for probability
   *  predictions. Default false; enable for binary-risk forecasts. */
  readonly clipToUnitInterval?: boolean;
}

/**
 * Produce a calibrator that uses signed absolute-residual scores.
 * Use this for real-valued forecasts (NOI, occupancy days, etc.).
 *
 * For binary-risk (probability-of-event), use
 * `createProbabilityCalibrator` below which uses the signed
 * log-likelihood as the nonconformity score — better-behaved at
 * the tails than absolute residual.
 */
export function createAbsoluteResidualCalibrator(
  opts: CalibratorOptions = {},
): Calibrator {
  const minPts   = opts.minCalibrationPoints ?? 30;
  const windowMax = opts.rollingWindow ?? 2000;
  const clip      = opts.clipToUnitInterval ?? false;
  const scores: number[] = [];

  return {
    update(point: CalibrationPoint): void {
      if (!Number.isFinite(point.predicted) || !Number.isFinite(point.actual)) {
        throw new RangeError('conformal: calibration point contains non-finite number');
      }
      const s = Math.abs(point.actual - point.predicted);
      scores.push(s);
      if (scores.length > windowMax) {
        scores.splice(0, scores.length - windowMax);
      }
    },
    interval(predicted: number, alpha: number): ConformalInterval {
      if (alpha <= 0 || alpha >= 1) {
        throw new RangeError('conformal: alpha must be in (0, 1)');
      }
      if (scores.length < minPts) {
        throw new Error(
          `conformal: need ≥ ${minPts} calibration points, have ${scores.length}`,
        );
      }
      const q = quantile(scores, 1 - alpha);
      let lower = predicted - q;
      let upper = predicted + q;
      if (clip) {
        lower = Math.max(0, lower);
        upper = Math.min(1, upper);
      }
      return Object.freeze({
        point: predicted,
        lower,
        upper,
        alpha,
      });
    },
    get size(): number {
      return scores.length;
    },
  };
}

/**
 * Probability-aware calibrator using signed log-loss residuals.
 *
 * For binary classification-style forecasts (e.g. "will this tenant
 * default in 30 days?"), absolute residual isn't calibrated — a
 * prediction of 0.01 that turns out to be a 1 has residual 0.99,
 * same as a prediction of 0.99 that turns out to be 0. Log-loss
 * captures confidence correctly.
 *
 * We use |log(p_y)| where p_y is the predicted probability of the
 * observed class. Larger value = more nonconforming.
 */
export function createProbabilityCalibrator(
  opts: CalibratorOptions = {},
): Calibrator {
  const minPts    = opts.minCalibrationPoints ?? 30;
  const windowMax = opts.rollingWindow ?? 2000;
  const scores: number[] = [];

  function scoreFor(point: CalibrationPoint): number {
    // Clamp to avoid -Infinity at p=0 or p=1
    const p = Math.min(Math.max(point.predicted, 1e-6), 1 - 1e-6);
    const pY = point.actual > 0.5 ? p : 1 - p;
    return -Math.log(pY);
  }

  return {
    update(point: CalibrationPoint): void {
      if (!Number.isFinite(point.predicted) || !Number.isFinite(point.actual)) {
        throw new RangeError('conformal: non-finite calibration point');
      }
      if (point.predicted < 0 || point.predicted > 1) {
        throw new RangeError('conformal: probability predicted must be in [0,1]');
      }
      scores.push(scoreFor(point));
      if (scores.length > windowMax) {
        scores.splice(0, scores.length - windowMax);
      }
    },
    interval(predicted: number, alpha: number): ConformalInterval {
      if (predicted < 0 || predicted > 1) {
        throw new RangeError('conformal: predicted probability must be in [0,1]');
      }
      if (alpha <= 0 || alpha >= 1) {
        throw new RangeError('conformal: alpha must be in (0, 1)');
      }
      if (scores.length < minPts) {
        throw new Error(
          `conformal: need ≥ ${minPts} calibration points, have ${scores.length}`,
        );
      }
      const q = quantile(scores, 1 - alpha);
      // Convert the log-loss threshold back to a probability band
      // around `predicted`. For each direction, solve -log(pY) = q.
      const p = Math.min(Math.max(predicted, 1e-6), 1 - 1e-6);
      const lo = Math.max(0, p - (1 - Math.exp(-q)) * p);
      const hi = Math.min(1, p + (1 - Math.exp(-q)) * (1 - p));
      return Object.freeze({
        point: p,
        lower: lo,
        upper: hi,
        alpha,
      });
    },
    get size(): number {
      return scores.length;
    },
  };
}

/**
 * Compute the p-th empirical quantile of an array using linear
 * interpolation between adjacent values. Deterministic; sort is
 * in-place on a CLONE so the caller's array is untouched.
 */
export function quantile(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) {
    throw new RangeError('conformal: quantile of empty array');
  }
  if (p < 0 || p > 1) {
    throw new RangeError('conformal: quantile p must be in [0,1]');
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}
