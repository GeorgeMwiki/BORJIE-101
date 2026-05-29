/**
 * Forecast measurer — reduces raw forecast observations to the three
 * capability-catalogue axes (competence / calibration / utility).
 *
 * Spec §3.1 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Competence : did the realised value at the forecast horizon fall
 *              inside the predicted 80 % interval (`compRate_80`) and
 *              the 95 % interval (`compRate_95`)? Aggregate competence
 *              rate = 0.5 * compRate_80 + 0.5 * compRate_95. This is
 *              the classical interval-coverage score from probabilistic
 *              forecasting — Gneiting & Raftery, "Strictly Proper
 *              Scoring Rules, Prediction, and Estimation", J. Amer.
 *              Statist. Assoc. 102 (2007): 359–378.
 *              https://www.tandfonline.com/doi/abs/10.1198/016214506000001437
 *
 * Calibration: |empirical_80 − 0.80| + |empirical_95 − 0.95|, bounded
 *              to [0, 1]. See Vovk et al., *Algorithmic Learning in a
 *              Random World*, 2nd ed., Springer 2022, Ch. 1–3.
 *              https://link.springer.com/book/10.1007/978-3-031-06649-8
 *
 * Utility    : accepted / modified ⇒ 1 ; rejected / ignored ⇒ 0.
 *
 * @module @borjie/intel-self-improve/measure/forecast-measurer
 */

import type {
  ObservedOutcome,
  UserFollowthrough,
} from '@borjie/capability-catalogue';

// ---------------------------------------------------------------------------
// Per-call observation — one row per resolved forecast
// ---------------------------------------------------------------------------

export interface ForecastObservation {
  readonly observedValue: number;
  readonly interval80: { readonly lower: number; readonly upper: number };
  readonly interval95: { readonly lower: number; readonly upper: number };
  readonly userFollowthrough: UserFollowthrough;
}

// ---------------------------------------------------------------------------
// Per-call simplified input — used by the new per-row measurement path
// where the caller provides a single interval + the nominal coverage it
// was sold at (e.g. 0.8 for an 80% PI). Keeps the API ergonomic for
// the verifier's outcome-observer attach path which only knows about
// one interval at a time.
// ---------------------------------------------------------------------------

export interface ForecastMeasurementInput {
  readonly intervalLower: number;
  readonly intervalUpper: number;
  readonly observedValue: number;
  readonly claimedCoverage: number;
}

/**
 * Per-call forecast measurement result. Maps cleanly onto the
 * outcome-observer's `ObservedOutcome` ("confirmed" when the realised
 * value falls inside the predicted interval, "disconfirmed" otherwise).
 */
export interface ForecastMeasurement {
  readonly inside: boolean;
  readonly competence: number;
  readonly claimedCoverage: number;
  readonly observedOutcome: ObservedOutcome;
}

/**
 * Cohort summary returned by `summariseForecastCohort`. Aggregates the
 * per-call results into the empirical coverage rate and the same
 * competence axis the cohort-wide `measureForecasts` exposes.
 */
export interface ForecastCohortSummary {
  readonly n: number;
  readonly empiricalCoverage: number;
  readonly competenceRate: number;
  readonly insideCount: number;
}

// ---------------------------------------------------------------------------
// Aggregate output — three-axis result
// ---------------------------------------------------------------------------

export interface ForecastMeasurementResult {
  readonly competenceRate: number;
  readonly calibrationError: number;
  readonly utilityRate: number;
  readonly nObservations: number;
  readonly empirical80: number;
  readonly empirical95: number;
}

function inside(value: number, interval: { readonly lower: number; readonly upper: number }): boolean {
  return value >= interval.lower && value <= interval.upper;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Aggregate the three axes over a cohort of forecast observations.
 *
 * Throws `RangeError` for an empty cohort because zero observations
 * means zero signal — the caller should never present an empty list
 * (the measurement worker filters by window before calling).
 */
export function measureForecasts(
  observations: ReadonlyArray<ForecastObservation>,
): ForecastMeasurementResult {
  if (observations.length === 0) {
    throw new RangeError('measureForecasts: empty observations cohort');
  }

  let inside80Count = 0;
  let inside95Count = 0;
  let utilityCount = 0;

  for (const obs of observations) {
    if (inside(obs.observedValue, obs.interval80)) inside80Count += 1;
    if (inside(obs.observedValue, obs.interval95)) inside95Count += 1;
    if (
      obs.userFollowthrough === 'accepted' ||
      obs.userFollowthrough === 'modified'
    ) {
      utilityCount += 1;
    }
  }

  const empirical80 = inside80Count / observations.length;
  const empirical95 = inside95Count / observations.length;
  const competenceRate = clamp01(0.5 * empirical80 + 0.5 * empirical95);
  const calibrationError = clamp01(
    Math.abs(empirical80 - 0.8) + Math.abs(empirical95 - 0.95),
  );
  const utilityRate = clamp01(utilityCount / observations.length);

  return Object.freeze({
    competenceRate,
    calibrationError,
    utilityRate,
    nObservations: observations.length,
    empirical80,
    empirical95,
  });
}

// ---------------------------------------------------------------------------
// Per-call measurement
// ---------------------------------------------------------------------------

function assertFiniteForecast(input: ForecastMeasurementInput): void {
  if (!Number.isFinite(input.intervalLower)) {
    throw new RangeError('measureForecast: intervalLower must be finite');
  }
  if (!Number.isFinite(input.intervalUpper)) {
    throw new RangeError('measureForecast: intervalUpper must be finite');
  }
  if (!Number.isFinite(input.observedValue)) {
    throw new RangeError('measureForecast: observedValue must be finite');
  }
  if (!Number.isFinite(input.claimedCoverage)) {
    throw new RangeError('measureForecast: claimedCoverage must be finite');
  }
  if (input.intervalUpper < input.intervalLower) {
    throw new RangeError(
      'measureForecast: intervalUpper must be ≥ intervalLower',
    );
  }
}

/**
 * Measure a single resolved forecast against its claimed interval.
 * Returns an `inside` flag, the [0, 1] competence reward (1 inside, 0
 * outside), the claimed nominal coverage, and the
 * `ObservedOutcome` enum the outcome-observer table expects.
 */
export function measureForecast(
  input: ForecastMeasurementInput,
): ForecastMeasurement {
  assertFiniteForecast(input);
  const inside =
    input.observedValue >= input.intervalLower &&
    input.observedValue <= input.intervalUpper;
  const claimed = Math.min(1, Math.max(0, input.claimedCoverage));
  return Object.freeze({
    inside,
    competence: inside ? 1 : 0,
    claimedCoverage: claimed,
    observedOutcome: inside ? 'confirmed' : 'disconfirmed',
  });
}

/**
 * Aggregate per-call forecast measurements into a cohort summary.
 * Empirical coverage = fraction inside; competence rate is the same
 * scalar in [0, 1].
 */
export function summariseForecastCohort(
  measurements: ReadonlyArray<ForecastMeasurement>,
): ForecastCohortSummary {
  if (measurements.length === 0) {
    throw new RangeError('summariseForecastCohort: empty measurements cohort');
  }
  let insideCount = 0;
  for (const m of measurements) if (m.inside) insideCount += 1;
  const empirical = insideCount / measurements.length;
  return Object.freeze({
    n: measurements.length,
    empiricalCoverage: empirical,
    competenceRate: empirical,
    insideCount,
  });
}
