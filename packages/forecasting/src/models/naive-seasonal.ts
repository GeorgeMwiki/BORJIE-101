/**
 * Naive seasonal forecaster.
 *
 * For each step h ahead, predicts the value at the most recent
 * observation that is exactly one season-cycle behind. This is the
 * canonical floor model for any seasonal series — every model in the
 * pack must beat it to justify its complexity, per Hyndman & Koehler.
 */

import type {
  ForecastingPort,
  TimeSeriesForecast,
} from '../types.js';
import {
  assertValidSeries,
  buildForecastIntervals,
  futureTimestamps,
  stdDev,
  values,
} from '../util/series.js';

export interface NaiveSeasonalOptions {
  /** Override the default seasonal period (in steps). Inferred from
   *  the series frequency if omitted (e.g. 12 for monthly). */
  readonly seasonalPeriod?: number;
  /** Floor for the heuristic half-width. Default 0. */
  readonly minHalfWidth?: number;
  /** Scale on residual std for the heuristic interval. Default 1.645
   *  (≈ 90% gaussian half-width). */
  readonly intervalZ?: number;
}

const FREQUENCY_DEFAULT_SEASON: Readonly<Record<string, number>> = Object.freeze({
  hourly:    24,
  daily:     7,
  weekly:    52,
  monthly:   12,
  quarterly: 4,
  yearly:    1,
});

export function createNaiveSeasonalForecaster(
  opts: NaiveSeasonalOptions = {},
): ForecastingPort {
  return {
    kind: 'naive-seasonal',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon, opts: callOpts } = args;
      assertValidSeries(series);
      if (series.points.length === 0) {
        throw new RangeError('naive-seasonal: cannot forecast on empty series');
      }
      const alpha = callOpts?.alpha ?? 0.1;
      const season =
        callOpts?.seasonality ??
        opts.seasonalPeriod ??
        FREQUENCY_DEFAULT_SEASON[series.frequency] ??
        1;
      const z = opts.intervalZ ?? 1.645;
      const minHalfWidth = opts.minHalfWidth ?? 0;

      const ys = values(series);
      const n = ys.length;

      // Forecast: y_{n+h} = y_{n + h - k*season} where k chosen so the
      // index lands inside the observed series. Fall back to the last
      // observed value if the series is shorter than one season.
      const fc: number[] = [];
      for (let h = 1; h <= horizon.steps; h += 1) {
        if (n < season) {
          fc.push(ys[n - 1]!);
          continue;
        }
        // step back by (((h - 1) mod season) + 1) from the END
        const offset = ((h - 1) % season) + 1;
        const lookbackIdx = n - season - 1 + offset;
        // Guarded — clamp if necessary
        const idx = Math.max(0, Math.min(n - 1, lookbackIdx));
        // Actually we want to wrap: predict by the most recent
        // observation at lag = season - (h - 1) % season equivalents.
        // Simpler equivalent: take y[n - season + ((h - 1) % season)].
        const j = n - season + ((h - 1) % season);
        fc.push(ys[Math.max(0, Math.min(n - 1, j))] ?? ys[idx]!);
      }

      // Heuristic interval: ± z * std(in-sample seasonal residuals).
      // Use lag-`season` differences as a quick proxy.
      let halfWidth = minHalfWidth;
      if (n > season) {
        const diffs: number[] = [];
        for (let i = season; i < n; i += 1) diffs.push(ys[i]! - ys[i - season]!);
        halfWidth = Math.max(minHalfWidth, z * stdDev(diffs));
      }

      const future = futureTimestamps(series, horizon.steps);
      const points = future.map((_, i) => fc[i]!);
      const lower = points.map((p) => p - halfWidth);
      const upper = points.map((p) => p + halfWidth);
      const intervals = buildForecastIntervals({
        future,
        points,
        lower,
        upper,
        alpha,
        conformal: false,
      });

      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'naive-seasonal',
        modelVersion: 'naive-seasonal-1',
        horizon,
        points:       intervals,
        generatedAt:  new Date().toISOString(),
        meta:         { seasonalPeriod: season, halfWidth },
      });
    },
  };
}
