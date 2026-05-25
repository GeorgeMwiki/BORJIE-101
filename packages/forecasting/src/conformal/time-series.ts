/**
 * Conformal-interval wrapper for time-series forecasters.
 *
 * Inductive Conformal Prediction (ICP) applied per-horizon-step on a
 * held-out calibration set. Given a fitted base predictor and a list
 * of past series-with-known-future pairs, this computes per-step
 * absolute-residual quantiles q_h and returns a wrapped predictor
 * whose `ForecastInterval[h].lower / .upper = point ∓ q_h`.
 *
 * The coverage guarantee (Vovk et al.) holds under exchangeability of
 * the calibration and test residuals. For non-stationary time-series
 * we recommend rolling-window calibration; this module exposes the
 * window cap via `rollingWindow`.
 */

import type {
  ForecastingPort,
  Horizon,
  TimeSeries,
  TimeSeriesForecast,
} from '../types.js';
import { buildForecastIntervals } from '../util/series.js';
import { quantile } from './inductive.js';

/** A single calibration sample: a series prefix + the actual values
 *  for the next `horizon.steps` steps. */
export interface CalibrationSample {
  readonly series: TimeSeries;
  readonly actuals: ReadonlyArray<number>;
  readonly horizon: Horizon;
}

export interface ConformalWrapperOptions {
  /** Maximum calibration residuals to keep per horizon-step. */
  readonly rollingWindow?: number;
  /** Minimum calibration residuals required per step. */
  readonly minPerStep?: number;
  /** Optional clamp lower/upper to a domain box, e.g. [0,1] for
   *  occupancy probabilities. */
  readonly clamp?: { readonly lower: number; readonly upper: number };
}

/** Compute per-horizon-step absolute residuals from a calibration set. */
async function computePerStepResiduals(args: {
  readonly base: ForecastingPort;
  readonly calibration: ReadonlyArray<CalibrationSample>;
  readonly horizon: Horizon;
}): Promise<ReadonlyArray<ReadonlyArray<number>>> {
  const { base, calibration, horizon } = args;
  const residualsPerStep: number[][] = Array.from(
    { length: horizon.steps },
    () => [],
  );
  for (const sample of calibration) {
    if (sample.actuals.length < horizon.steps) continue;
    const fc = await base.predict({
      series: sample.series,
      horizon,
    });
    for (let h = 0; h < horizon.steps; h += 1) {
      const pred   = fc.points[h]!.point;
      const actual = sample.actuals[h]!;
      residualsPerStep[h]!.push(Math.abs(actual - pred));
    }
  }
  return residualsPerStep;
}

/**
 * Wrap a base predictor with conformal-calibrated intervals.
 *
 * The wrapper performs calibration eagerly (on construction) so the
 * runtime predict path stays cheap. Re-wrap when new calibration data
 * arrives.
 */
export async function wrapWithConformalIntervals(args: {
  readonly base: ForecastingPort;
  readonly calibration: ReadonlyArray<CalibrationSample>;
  readonly horizon: Horizon;
  readonly alpha?: number;
  readonly opts?: ConformalWrapperOptions;
}): Promise<ForecastingPort> {
  const { base, calibration, horizon } = args;
  const alpha = args.alpha ?? 0.1;
  const minPerStep = args.opts?.minPerStep ?? 30;
  const rollingWindow = args.opts?.rollingWindow ?? 2000;
  const clamp = args.opts?.clamp;

  if (calibration.length === 0) {
    throw new RangeError('conformal: calibration set is empty');
  }

  const allResiduals = await computePerStepResiduals({
    base,
    calibration,
    horizon,
  });

  const trimmed = allResiduals.map((arr) =>
    arr.length > rollingWindow ? arr.slice(arr.length - rollingWindow) : arr,
  );
  for (let h = 0; h < trimmed.length; h += 1) {
    if (trimmed[h]!.length < minPerStep) {
      throw new RangeError(
        `conformal: horizon step ${h + 1} has only ${trimmed[h]!.length} residuals, need ≥ ${minPerStep}`,
      );
    }
  }
  const perStepQuantile = trimmed.map((arr) => quantile(arr, 1 - alpha));

  return {
    kind: base.kind,
    async predict(callArgs): Promise<TimeSeriesForecast> {
      const fc = await base.predict({
        series:  callArgs.series,
        horizon: callArgs.horizon ?? horizon,
        ...(callArgs.opts !== undefined ? { opts: callArgs.opts } : {}),
      });
      // Only the first `horizon.steps` are conformal-calibrated;
      // a request for a different horizon is allowed but the extra
      // steps fall back to the base's intervals.
      const effectiveHorizon = callArgs.horizon ?? horizon;
      const future = fc.points.map((p) => p.t);
      const points = fc.points.map((p) => p.point);
      const lower  = fc.points.map((p, i) => {
        if (i < perStepQuantile.length) {
          const v = p.point - perStepQuantile[i]!;
          return clamp ? Math.max(clamp.lower, v) : v;
        }
        return p.lower;
      });
      const upper = fc.points.map((p, i) => {
        if (i < perStepQuantile.length) {
          const v = p.point + perStepQuantile[i]!;
          return clamp ? Math.min(clamp.upper, v) : v;
        }
        return p.upper;
      });
      const intervals = buildForecastIntervals({
        future,
        points,
        lower,
        upper,
        alpha,
        conformal: true,
      });
      return Object.freeze({
        ...fc,
        horizon: effectiveHorizon,
        points: intervals,
      });
    },
  };
}
