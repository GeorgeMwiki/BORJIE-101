/**
 * Trajectory prediction — deterministic forward simulation of a
 * property / tenant / owner state vector. The implementation is a
 * least-squares linear extrapolator per numeric field plus an
 * uncertainty band that widens with horizon.
 *
 * Why so simple? The kernel needs a forecast it can ALWAYS produce —
 * even with 6 historical points, even if the data is noisy. Linear
 * extrapolation is robust, fast, and explainable; it does NOT pretend
 * to capture seasonality or non-linear dynamics. A learned model
 * (JEPA, lightweight transformer, etc.) can be swapped behind the same
 * `forecastPropertyTrajectory` / `forecastTenantArrearsTrajectory` /
 * `forecastOwnerCashflow` ports without changing the call sites or
 * the world-model tools.
 *
 * Conventions:
 *   - history is ordered oldest-first
 *   - `t` is days since the most recent point (point0)
 *   - rate fields are clamped to [0, 1]; counts to ≥0
 *   - regime + inflection days are derived from the property forecast
 *   - all timestamps are ISO-8601 strings
 */

import type {
  AgencyState,
  OwnerState,
  PropertyState,
  TenantState,
} from './state-vectors.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface TrajectoryPoint<S> {
  readonly state: S;
  readonly horizonDays: number;
  readonly confidence: number;            // [0,1] — drops with horizon
}

export type PropertyRegime =
  | 'stable'
  | 'recovering'
  | 'declining'
  | 'volatile';

export interface PropertyTrajectory {
  readonly point0: PropertyState;
  readonly forecast: ReadonlyArray<TrajectoryPoint<PropertyState>>;
  readonly regime: PropertyRegime;
  readonly notableInflectionDays: ReadonlyArray<number>;
}

export interface TrajectoryDeps {
  readonly history: ReadonlyArray<PropertyState>;
  readonly horizonDays?: number;
  readonly samplePoints?: number;
}

export interface ArrearsTrajectoryPoint {
  readonly horizonDays: number;
  readonly expected: number;
  readonly p10: number;
  readonly p90: number;
}

export interface DefaultProbabilityPoint {
  readonly horizonDays: number;
  readonly probability: number;
}

export interface ArrearsTrajectory {
  readonly point0: TenantState;
  readonly arrearsAmountMajorAt: ReadonlyArray<ArrearsTrajectoryPoint>;
  readonly defaultProbabilityAt: ReadonlyArray<DefaultProbabilityPoint>;
}

export interface NetCollectionRatePoint {
  readonly horizonDays: number;
  readonly rate: number;
  readonly p10: number;
  readonly p90: number;
}

export interface OwnerCashflowTrajectory {
  readonly point0: OwnerState;
  readonly netCollectionRateForecast: ReadonlyArray<NetCollectionRatePoint>;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_HORIZON_DAYS = 90;
const DEFAULT_SAMPLE_POINTS = 6;
const VACANCY_INFLECTION_THRESHOLD = 0.15;
const ARREARS_INFLECTION_THRESHOLD = 0.10;
const DECLINING_VACANCY_SLOPE_PER_DAY = 0.005;
const DECLINING_ARREARS_SLOPE_PER_DAY = 0.005;
const VOLATILITY_CV_THRESHOLD = 0.30; // std-dev / mean

// ─────────────────────────────────────────────────────────────────────
// Numeric helpers — pure, immutable. No object mutation anywhere.
// ─────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampNonNegative(value: number): number {
  return clamp(value, 0, Number.POSITIVE_INFINITY);
}

/**
 * Returns the days between two ISO-8601 timestamps. Uses absolute
 * diff so caller order doesn't matter; returns 0 on parse failure.
 */
function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

interface LinearFit {
  readonly intercept: number;
  readonly slopePerDay: number;
}

/**
 * Least-squares linear regression of `values` against `times` (days).
 * Falls back to {intercept: last, slope: 0} when the time spread is
 * zero (single point or all timestamps identical).
 */
function fitLinear(times: ReadonlyArray<number>, values: ReadonlyArray<number>): LinearFit {
  const n = Math.min(times.length, values.length);
  if (n === 0) return { intercept: 0, slopePerDay: 0 };
  if (n === 1) {
    const only = values[0];
    return { intercept: only ?? 0, slopePerDay: 0 };
  }

  let sumT = 0;
  let sumV = 0;
  for (let i = 0; i < n; i += 1) {
    sumT += times[i] ?? 0;
    sumV += values[i] ?? 0;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dt = (times[i] ?? 0) - meanT;
    const dv = (values[i] ?? 0) - meanV;
    num += dt * dv;
    den += dt * dt;
  }

  if (den === 0) {
    const last = values[n - 1] ?? 0;
    return { intercept: last, slopePerDay: 0 };
  }

  const slopePerDay = num / den;
  // Re-anchor intercept on the most recent observation (time = max time)
  // so `value(t) = intercept + slope * t` reads cleanly with t = days
  // forward from point0.
  const maxT = Math.max(...times);
  const interceptAtMax = meanV + slopePerDay * (maxT - meanT);
  return { intercept: interceptAtMax, slopePerDay };
}

function meanOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stdDevOf(values: ReadonlyArray<number>): number {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / values.length);
}

function coefficientOfVariation(values: ReadonlyArray<number>): number {
  const m = meanOf(values);
  if (m === 0) return 0;
  return stdDevOf(values) / Math.abs(m);
}

/**
 * Confidence in a forecast at horizon `t` against a maximum of
 * `horizonMax`. Confidence drops linearly to a floor of 0.1.
 */
function confidenceAt(t: number, horizonMax: number): number {
  if (horizonMax <= 0) return 1;
  const c = 1 - (t / horizonMax) * 0.7;
  return clamp(c, 0.1, 1);
}

/**
 * Evenly-spaced sample points between t=0 and t=horizonDays inclusive.
 * For samplePoints=6 with horizon=90 returns [0, 18, 36, 54, 72, 90].
 */
function sampleHorizons(
  horizonDays: number,
  samplePoints: number,
): ReadonlyArray<number> {
  const n = Math.max(samplePoints, 2);
  const step = horizonDays / (n - 1);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(i === n - 1 ? horizonDays : i * step);
  }
  return Object.freeze(out);
}

// ─────────────────────────────────────────────────────────────────────
// Property history → field-wise linear fits
// ─────────────────────────────────────────────────────────────────────

interface PropertyHistorySeries {
  readonly times: ReadonlyArray<number>;
  readonly vacancyRate: ReadonlyArray<number>;
  readonly avgRentMajor: ReadonlyArray<number>;
  readonly arrearsRate: ReadonlyArray<number>;
  readonly maintenanceBacklog: ReadonlyArray<number>;
  readonly renewalRate: ReadonlyArray<number>;
  readonly turnoverRate: ReadonlyArray<number>;
  readonly conditionScore: ReadonlyArray<number>;
}

function buildPropertySeries(
  history: ReadonlyArray<PropertyState>,
): PropertyHistorySeries {
  if (history.length === 0) {
    const empty: ReadonlyArray<number> = Object.freeze([]);
    return {
      times: empty,
      vacancyRate: empty,
      avgRentMajor: empty,
      arrearsRate: empty,
      maintenanceBacklog: empty,
      renewalRate: empty,
      turnoverRate: empty,
      conditionScore: empty,
    };
  }
  const oldest = history[0]?.observedAt ?? '';
  const times = history.map((s) => daysBetween(oldest, s.observedAt));
  return {
    times,
    vacancyRate: history.map((s) => s.vacancyRate),
    avgRentMajor: history.map((s) => s.avgRentMajor),
    arrearsRate: history.map((s) => s.arrearsRate),
    maintenanceBacklog: history.map((s) => s.maintenanceBacklog),
    renewalRate: history.map((s) => s.renewalRate),
    turnoverRate: history.map((s) => s.turnoverRate),
    conditionScore: history.map((s) => s.conditionScore),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Regime detection — classifies the property history into one of:
// stable / recovering / declining / volatile.
// ─────────────────────────────────────────────────────────────────────

function detectPropertyRegime(
  history: ReadonlyArray<PropertyState>,
  vacancySlope: number,
  arrearsSlope: number,
): PropertyRegime {
  // Volatility check on the most recent ~3 months of history (assumes
  // monthly observations; uses last 3 records as proxy when fewer).
  const recent = history.slice(-3);
  if (recent.length >= 3) {
    const fields: ReadonlyArray<ReadonlyArray<number>> = [
      recent.map((s) => s.vacancyRate),
      recent.map((s) => s.arrearsRate),
      recent.map((s) => s.avgRentMajor),
      recent.map((s) => s.conditionScore),
    ];
    for (const field of fields) {
      if (coefficientOfVariation(field) > VOLATILITY_CV_THRESHOLD) {
        return 'volatile';
      }
    }
  }

  if (
    vacancySlope > DECLINING_VACANCY_SLOPE_PER_DAY ||
    arrearsSlope > DECLINING_ARREARS_SLOPE_PER_DAY
  ) {
    return 'declining';
  }

  if (vacancySlope < 0 && arrearsSlope < 0) {
    return 'recovering';
  }

  return 'stable';
}

/**
 * The day in the forecast horizon where `value(t) = intercept + slope*t`
 * first crosses `threshold`. Returns null if it never crosses within the
 * horizon, or when slope ≤ 0 and the value already sits below threshold.
 */
function inflectionDay(
  intercept: number,
  slopePerDay: number,
  threshold: number,
  horizonDays: number,
): number | null {
  // Already above threshold at t=0 → "inflection" was in the past, not
  // in the forecast window.
  if (intercept >= threshold) return null;
  if (slopePerDay <= 0) return null;
  const t = (threshold - intercept) / slopePerDay;
  if (!Number.isFinite(t) || t < 0 || t > horizonDays) return null;
  return Math.round(t);
}

// ─────────────────────────────────────────────────────────────────────
// Public API — property trajectory
// ─────────────────────────────────────────────────────────────────────

/**
 * Forward-simulate the property state vector using per-field linear
 * extrapolation. Returns the regime classification and any horizon-day
 * at which a key threshold (vacancy ≥ 15%, arrears ≥ 10%) is first
 * crossed.
 *
 * Throws when history is empty — callers should pre-check.
 */
export function forecastPropertyTrajectory(
  deps: TrajectoryDeps,
): PropertyTrajectory {
  const { history } = deps;
  if (history.length === 0) {
    throw new Error('forecastPropertyTrajectory: history is empty');
  }
  const horizonDays = deps.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const samplePoints = deps.samplePoints ?? DEFAULT_SAMPLE_POINTS;
  const point0 = history[history.length - 1] as PropertyState;
  const series = buildPropertySeries(history);

  const fits = {
    vacancyRate: fitLinear(series.times, series.vacancyRate),
    avgRentMajor: fitLinear(series.times, series.avgRentMajor),
    arrearsRate: fitLinear(series.times, series.arrearsRate),
    maintenanceBacklog: fitLinear(series.times, series.maintenanceBacklog),
    renewalRate: fitLinear(series.times, series.renewalRate),
    turnoverRate: fitLinear(series.times, series.turnoverRate),
    conditionScore: fitLinear(series.times, series.conditionScore),
  };

  const horizons = sampleHorizons(horizonDays, samplePoints);
  const forecast = horizons.map((t): TrajectoryPoint<PropertyState> => {
    const projected: PropertyState = {
      propertyId: point0.propertyId,
      tenantId: point0.tenantId,
      observedAt: addDaysIso(point0.observedAt, t),
      vacancyRate: clamp01(fits.vacancyRate.intercept + fits.vacancyRate.slopePerDay * t),
      avgRentMajor: clampNonNegative(
        fits.avgRentMajor.intercept + fits.avgRentMajor.slopePerDay * t,
      ),
      currency: point0.currency,
      arrearsRate: clamp01(fits.arrearsRate.intercept + fits.arrearsRate.slopePerDay * t),
      maintenanceBacklog: Math.round(
        clampNonNegative(
          fits.maintenanceBacklog.intercept + fits.maintenanceBacklog.slopePerDay * t,
        ),
      ),
      renewalRate: clamp01(
        fits.renewalRate.intercept + fits.renewalRate.slopePerDay * t,
      ),
      turnoverRate: clamp01(
        fits.turnoverRate.intercept + fits.turnoverRate.slopePerDay * t,
      ),
      conditionScore: clamp01(
        fits.conditionScore.intercept + fits.conditionScore.slopePerDay * t,
      ),
    };
    return {
      state: projected,
      horizonDays: t,
      confidence: confidenceAt(t, horizonDays),
    };
  });

  const regime = detectPropertyRegime(
    history,
    fits.vacancyRate.slopePerDay,
    fits.arrearsRate.slopePerDay,
  );

  const inflections: number[] = [];
  const vacancyDay = inflectionDay(
    fits.vacancyRate.intercept,
    fits.vacancyRate.slopePerDay,
    VACANCY_INFLECTION_THRESHOLD,
    horizonDays,
  );
  if (vacancyDay !== null) inflections.push(vacancyDay);
  const arrearsDay = inflectionDay(
    fits.arrearsRate.intercept,
    fits.arrearsRate.slopePerDay,
    ARREARS_INFLECTION_THRESHOLD,
    horizonDays,
  );
  if (arrearsDay !== null) inflections.push(arrearsDay);

  return {
    point0,
    forecast: Object.freeze(forecast),
    regime,
    notableInflectionDays: Object.freeze(inflections),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API — tenant arrears trajectory
// ─────────────────────────────────────────────────────────────────────

interface TenantArrearsArgs {
  readonly history: ReadonlyArray<TenantState>;
  readonly horizonDays?: number;
  readonly samplePoints?: number;
}

export function forecastTenantArrearsTrajectory(
  args: TenantArrearsArgs,
): ArrearsTrajectory {
  const { history } = args;
  if (history.length === 0) {
    throw new Error('forecastTenantArrearsTrajectory: history is empty');
  }
  const horizonDays = args.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const samplePoints = args.samplePoints ?? DEFAULT_SAMPLE_POINTS;
  const point0 = history[history.length - 1] as TenantState;

  const oldest = history[0]?.observedAt ?? '';
  const times = history.map((s) => daysBetween(oldest, s.observedAt));
  const arrearsAmountSeries = history.map((s) => s.arrearsAmountMajor);
  const arrearsDaysSeries = history.map((s) => s.arrearsDays);
  const regularitySeries = history.map((s) => s.paymentRegularity);

  const arrearsFit = fitLinear(times, arrearsAmountSeries);
  const arrearsDaysFit = fitLinear(times, arrearsDaysSeries);
  const regularityFit = fitLinear(times, regularitySeries);

  const horizons = sampleHorizons(horizonDays, samplePoints);

  const arrearsAmountMajorAt = horizons.map((t): ArrearsTrajectoryPoint => {
    const expected = clampNonNegative(
      arrearsFit.intercept + arrearsFit.slopePerDay * t,
    );
    // p10/p90 widen with horizon: at t=30d ±5%, t=60d ±10%, etc.
    const widening = 0.05 * (t / 30);
    const p10 = clampNonNegative(expected * (1 - widening));
    const p90 = clampNonNegative(expected * (1 + widening));
    return { horizonDays: t, expected, p10, p90 };
  });

  // Default probability — combines rising arrears-days with falling
  // payment regularity into a logistic-ish bounded score on [0, 1].
  // This is intentionally a heuristic; a learned hazard model can
  // replace it without changing the API.
  const defaultProbabilityAt = horizons.map((t): DefaultProbabilityPoint => {
    const projectedDays = clampNonNegative(
      arrearsDaysFit.intercept + arrearsDaysFit.slopePerDay * t,
    );
    const projectedRegularity = clamp01(
      regularityFit.intercept + regularityFit.slopePerDay * t,
    );
    // Map: 0 days late → 0; 90 days late → ~0.6; longer → asymptote 1.
    // Penalise low payment regularity. Add a tiny horizon-uncertainty
    // tax so far-out forecasts read less crisp than near-term ones.
    const daysComponent = projectedDays / (projectedDays + 60);
    const regularityComponent = 1 - projectedRegularity;
    const blended = 0.6 * daysComponent + 0.4 * regularityComponent;
    const horizonTax = (t / horizonDays) * 0.05;
    const probability = clamp01(blended + horizonTax);
    return { horizonDays: t, probability };
  });

  return {
    point0,
    arrearsAmountMajorAt: Object.freeze(arrearsAmountMajorAt),
    defaultProbabilityAt: Object.freeze(defaultProbabilityAt),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API — owner cashflow trajectory
// ─────────────────────────────────────────────────────────────────────

interface OwnerCashflowArgs {
  readonly history: ReadonlyArray<OwnerState>;
  readonly horizonDays?: number;
  readonly samplePoints?: number;
}

export function forecastOwnerCashflow(
  args: OwnerCashflowArgs,
): OwnerCashflowTrajectory {
  const { history } = args;
  if (history.length === 0) {
    throw new Error('forecastOwnerCashflow: history is empty');
  }
  const horizonDays = args.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const samplePoints = args.samplePoints ?? DEFAULT_SAMPLE_POINTS;
  const point0 = history[history.length - 1] as OwnerState;

  const oldest = history[0]?.observedAt ?? '';
  const times = history.map((s) => daysBetween(oldest, s.observedAt));
  const collectionSeries = history.map((s) => s.netCollectionRate);

  const collectionFit = fitLinear(times, collectionSeries);

  const horizons = sampleHorizons(horizonDays, samplePoints);
  const netCollectionRateForecast = horizons.map(
    (t): NetCollectionRatePoint => {
      const rate = clamp01(
        collectionFit.intercept + collectionFit.slopePerDay * t,
      );
      const widening = 0.05 * (t / 30);
      const p10 = clamp01(rate - widening);
      const p90 = clamp01(rate + widening);
      return { horizonDays: t, rate, p10, p90 };
    },
  );

  return {
    point0,
    netCollectionRateForecast: Object.freeze(netCollectionRateForecast),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — ISO timestamp arithmetic. Pure; never mutates Date input.
// ─────────────────────────────────────────────────────────────────────

function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const next = new Date(ms + days * 86_400_000);
  return next.toISOString();
}

// Re-export AgencyState reference so consumers can co-import the
// vector + the regime types from a single barrel without forgetting
// to add the import. (The actual interface lives in state-vectors.ts.)
export type { AgencyState };
