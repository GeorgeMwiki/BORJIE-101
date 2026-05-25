/**
 * Time-series utility helpers — pure, zero-dep.
 *
 * Used by every local forecaster, every RE-specific composer, and the
 * backtesting harness. Keeping these pure (no I/O, no random) lets every
 * downstream consumer reason about determinism trivially.
 */

import type {
  ForecastInterval,
  TimePoint,
  TimeSeries,
  TimeSeriesFrequency,
} from '../types.js';

/** Minutes in one bucket for each supported frequency. */
const FREQUENCY_MINUTES: Readonly<Record<TimeSeriesFrequency, number>> = Object.freeze({
  hourly:    60,
  daily:     60 * 24,
  weekly:    60 * 24 * 7,
  monthly:   60 * 24 * 30,    // approx
  quarterly: 60 * 24 * 91,    // approx
  yearly:    60 * 24 * 365,   // approx
});

export function frequencyToMinutes(f: TimeSeriesFrequency): number {
  return FREQUENCY_MINUTES[f];
}

/** Validate the basic invariants of a time-series. Returns a copy with
 *  immutable points. Throws on non-finite values or non-monotonic time. */
export function assertValidSeries(series: TimeSeries): void {
  if (series.points.length === 0) return;
  let prev = -Infinity;
  for (let i = 0; i < series.points.length; i += 1) {
    const p = series.points[i]!;
    if (!Number.isFinite(p.y)) {
      throw new RangeError(`time-series ${series.id}: non-finite value at index ${i}`);
    }
    const ts = Date.parse(p.t);
    if (!Number.isFinite(ts)) {
      throw new RangeError(`time-series ${series.id}: unparseable timestamp at index ${i}: ${p.t}`);
    }
    if (ts < prev) {
      throw new RangeError(`time-series ${series.id}: non-monotonic time at index ${i}`);
    }
    prev = ts;
  }
}

/** Advance an ISO timestamp by `steps` buckets at the given frequency. */
export function advanceTimestamp(
  isoFrom: string,
  steps: number,
  frequency: TimeSeriesFrequency,
): string {
  const t = Date.parse(isoFrom);
  if (!Number.isFinite(t)) {
    throw new RangeError(`advanceTimestamp: unparseable from-timestamp ${isoFrom}`);
  }
  const advancedMs = t + steps * frequencyToMinutes(frequency) * 60 * 1000;
  return new Date(advancedMs).toISOString();
}

/** Build the future timestamps for a horizon, anchored on the last
 *  observation. */
export function futureTimestamps(
  series: TimeSeries,
  steps: number,
): ReadonlyArray<string> {
  if (series.points.length === 0) {
    // No anchor — synthesise from "now". Caller usually supplies a
    // non-empty series; this is a safety floor.
    const now = new Date().toISOString();
    return Array.from({ length: steps }, (_, i) =>
      advanceTimestamp(now, i + 1, series.frequency),
    );
  }
  const last = series.points[series.points.length - 1]!.t;
  return Array.from({ length: steps }, (_, i) =>
    advanceTimestamp(last, i + 1, series.frequency),
  );
}

/** Pull the y values out of a series. */
export function values(series: TimeSeries): ReadonlyArray<number> {
  return series.points.map((p) => p.y);
}

/** Compute the arithmetic mean of an array. Throws on empty. */
export function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) throw new RangeError('mean: empty array');
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Compute the standard deviation (sample, ddof=1). 0 when length < 2. */
export function stdDev(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - mu) * (x - mu);
  return Math.sqrt(acc / (xs.length - 1));
}

/** Compute the median of an array via in-place sort on a clone. */
export function median(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) throw new RangeError('median: empty array');
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[m - 1]! + sorted[m]!) / 2;
  }
  return sorted[m]!;
}

/** Build a `ForecastInterval[]` from parallel arrays. */
export function buildForecastIntervals(args: {
  readonly future: ReadonlyArray<string>;
  readonly points: ReadonlyArray<number>;
  readonly lower: ReadonlyArray<number>;
  readonly upper: ReadonlyArray<number>;
  readonly alpha: number;
  readonly conformal: boolean;
}): ReadonlyArray<ForecastInterval> {
  const { future, points, lower, upper, alpha, conformal } = args;
  if (
    future.length !== points.length ||
    points.length !== lower.length ||
    lower.length !== upper.length
  ) {
    throw new RangeError('buildForecastIntervals: array lengths must match');
  }
  const out: ForecastInterval[] = [];
  for (let i = 0; i < future.length; i += 1) {
    out.push(
      Object.freeze({
        step:      i + 1,
        t:         future[i]!,
        point:     points[i]!,
        lower:     lower[i]!,
        upper:     upper[i]!,
        alpha,
        conformal,
      }),
    );
  }
  return Object.freeze(out);
}

/** Build a "naive" symmetric heuristic interval at ± k * std(residuals).
 *  Used as the floor when no conformal calibration is provided. */
export function heuristicIntervals(args: {
  readonly future: ReadonlyArray<string>;
  readonly points: ReadonlyArray<number>;
  readonly halfWidth: number;
  readonly alpha: number;
}): ReadonlyArray<ForecastInterval> {
  const { future, points, halfWidth, alpha } = args;
  return buildForecastIntervals({
    future,
    points,
    lower: points.map((p) => p - halfWidth),
    upper: points.map((p) => p + halfWidth),
    alpha,
    conformal: false,
  });
}

/** Take the last `n` points from a series. Returns an empty array if
 *  the series is shorter than `n`. */
export function tail(series: TimeSeries, n: number): ReadonlyArray<TimePoint> {
  if (n <= 0) return [];
  const start = Math.max(0, series.points.length - n);
  return series.points.slice(start);
}

/** Difference a series at lag `k`. Output length = points.length - k. */
export function lagDifference(
  xs: ReadonlyArray<number>,
  k: number,
): ReadonlyArray<number> {
  if (k < 1) throw new RangeError('lagDifference: k must be ≥ 1');
  if (xs.length <= k) return [];
  const out: number[] = [];
  for (let i = k; i < xs.length; i += 1) {
    out.push(xs[i]! - xs[i - k]!);
  }
  return out;
}
