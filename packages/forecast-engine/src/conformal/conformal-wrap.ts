/**
 * Conformal wrapper — turns ANY provider's raw quantiles into
 * CALIBRATED prediction intervals with a finite-sample coverage
 * guarantee. Raw provider quantiles are NEVER surfaced (CLAUDE.md rail).
 *
 * Two modes, both split-conformal (Vovk et al.; Romano, Patterson &
 * Candès 2019 for CQR):
 *
 *  - SPLIT-CONFORMAL (absolute residual). Score = |y - point|.
 *    Symmetric band point ± Q_{1-alpha}(scores).
 *
 *  - CQR (Conformalized Quantile Regression). Score =
 *    max(qlo - y, y - qhi) using the provider's own lower/upper
 *    quantiles; the band is the provider quantiles widened (or
 *    tightened) by Q_{1-alpha}(scores). Adapts to heteroscedasticity
 *    far better than the symmetric residual band.
 *
 * This EXTENDS the existing online-conformal substrate: we import the
 * `@borjie/conformal-calibration-online` ACI state machine read-only and
 * use its finite-sample threshold rule, rather than re-implementing ACI.
 * The optional `onlineState` lets a caller feed a drift-adapted alpha
 * from the live ACI loop (DtACI-ready) instead of a fixed target.
 *
 * Pure + deterministic.
 */

import { conformalThresholdAt } from '@borjie/conformal-calibration-online';
import type { OnlineConformalState } from '@borjie/conformal-calibration-online';
import type {
  PredictionInterval,
  QuantileForecast,
  RawForecast,
} from '../types.js';
import { conformalQuantile, quantileKey } from '../util/quantiles.js';

export type ConformalMode = 'split' | 'cqr';

/**
 * One calibration record: what the provider forecast at a held-out
 * point, and what actually happened. The lower/upper are the provider's
 * raw quantiles at the nominal level (used by CQR).
 */
export interface CalibrationRecord {
  readonly point: number;
  readonly actual: number;
  readonly lowerQuantile: number;
  readonly upperQuantile: number;
}

export interface ConformalWrapConfig {
  /** Target coverage 1 - alpha. Default 0.9. */
  readonly targetCoverage?: number;
  /** 'split' (residual) or 'cqr' (quantile). Default 'cqr'. */
  readonly mode?: ConformalMode;
  /** Lower quantile level used for CQR scoring. Default derived from coverage. */
  readonly lowerLevel?: number;
  /** Upper quantile level used for CQR scoring. Default derived from coverage. */
  readonly upperLevel?: number;
  /**
   * Optional live ACI state. When present its `alpha` (drift-adapted)
   * overrides the static `1 - targetCoverage` for the threshold rule,
   * and the calibration threshold uses `conformalThresholdAt`.
   */
  readonly onlineState?: OnlineConformalState;
}

export interface ConformalWrapResult {
  readonly intervals: ReadonlyArray<PredictionInterval>;
  /** Nominal coverage actually applied (1 - effectiveAlpha). */
  readonly coverage: number;
  /** The conformal correction width added to each side (split mode) /
   *  to the quantile band (cqr mode). */
  readonly correction: number;
  readonly mode: ConformalMode;
}

function effectiveAlpha(config: ConformalWrapConfig): number {
  if (config.onlineState) return config.onlineState.alpha;
  const cov = config.targetCoverage ?? 0.9;
  return Math.min(0.5, Math.max(0.001, 1 - cov));
}

/** Build split-conformal nonconformity scores: |actual - point|. */
function splitScores(calibration: ReadonlyArray<CalibrationRecord>): number[] {
  return calibration.map((c) => Math.abs(c.actual - c.point));
}

/** Build CQR scores: max(qlo - y, y - qhi). */
function cqrScores(calibration: ReadonlyArray<CalibrationRecord>): number[] {
  return calibration.map((c) =>
    Math.max(c.lowerQuantile - c.actual, c.actual - c.upperQuantile),
  );
}

/**
 * Calibrate a provider's `RawForecast` into decision-grade intervals
 * using a held-out calibration set.
 */
export function calibrateForecast(
  raw: RawForecast,
  calibration: ReadonlyArray<CalibrationRecord>,
  config: ConformalWrapConfig = {},
): ConformalWrapResult {
  const mode: ConformalMode = config.mode ?? 'cqr';
  const alpha = effectiveAlpha(config);
  const coverage = 1 - alpha;

  const lowerLevel = config.lowerLevel ?? alpha / 2;
  const upperLevel = config.upperLevel ?? 1 - alpha / 2;
  const loKey = quantileKey(lowerLevel);
  const hiKey = quantileKey(upperLevel);

  const scores = mode === 'split' ? splitScores(calibration) : cqrScores(calibration);

  // Use the ACI finite-sample threshold when an online state is given
  // (lets the live drift-adapted loop drive the cut), else the local
  // finite-sample quantile. Both share the same Vovk correction.
  const correction = config.onlineState
    ? finiteThreshold(config.onlineState, scores)
    : conformalQuantile(scores, alpha);

  const safeCorrection = Number.isFinite(correction) ? correction : Number.POSITIVE_INFINITY;

  const intervals: PredictionInterval[] = raw.steps.map(
    (step: QuantileForecast): PredictionInterval => {
      if (mode === 'split') {
        return buildInterval(step.step, step.point, safeCorrection, alpha, true);
      }
      const qlo = step.quantiles[loKey] ?? step.point;
      const qhi = step.quantiles[hiKey] ?? step.point;
      return buildCqrInterval(step.step, step.point, qlo, qhi, safeCorrection, alpha);
    },
  );

  return {
    intervals,
    coverage,
    correction: Number.isFinite(correction) ? correction : Number.POSITIVE_INFINITY,
    mode,
  };
}

function finiteThreshold(
  state: OnlineConformalState,
  scores: ReadonlyArray<number>,
): number {
  const sorted = [...scores].sort((a, b) => a - b);
  return conformalThresholdAt(state, sorted);
}

function buildInterval(
  step: number,
  point: number,
  correction: number,
  alpha: number,
  _split: boolean,
): PredictionInterval {
  if (!Number.isFinite(correction)) {
    return {
      step,
      point,
      lower: Number.NEGATIVE_INFINITY,
      upper: Number.POSITIVE_INFINITY,
      alpha,
    };
  }
  return {
    step,
    point,
    lower: point - correction,
    upper: point + correction,
    alpha,
  };
}

function buildCqrInterval(
  step: number,
  point: number,
  qlo: number,
  qhi: number,
  correction: number,
  alpha: number,
): PredictionInterval {
  if (!Number.isFinite(correction)) {
    return {
      step,
      point,
      lower: Number.NEGATIVE_INFINITY,
      upper: Number.POSITIVE_INFINITY,
      alpha,
    };
  }
  // CQR widens (or tightens, if correction < 0) the provider's own
  // quantile band by the conformal correction.
  return {
    step,
    point,
    lower: Math.min(qlo, qhi) - correction,
    upper: Math.max(qlo, qhi) + correction,
    alpha,
  };
}
