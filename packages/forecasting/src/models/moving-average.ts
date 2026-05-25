/**
 * Simple-moving-average forecaster.
 *
 * Predicts every future step as the rolling mean of the last `window`
 * observations. Stable, dead-simple, useful as a smoothing baseline
 * for noisy stationary series.
 */

import type {
  ForecastingPort,
  TimeSeriesForecast,
} from '../types.js';
import {
  assertValidSeries,
  buildForecastIntervals,
  futureTimestamps,
  mean,
  stdDev,
  tail,
  values,
} from '../util/series.js';

export interface MovingAverageOptions {
  /** Number of points in the rolling window. Default 7. */
  readonly window?: number;
  /** Scale on residual std for the heuristic interval (≈ 90% = 1.645). */
  readonly intervalZ?: number;
  /** Floor for the heuristic half-width. */
  readonly minHalfWidth?: number;
}

export function createMovingAverageForecaster(
  opts: MovingAverageOptions = {},
): ForecastingPort {
  const window = opts.window ?? 7;
  const z = opts.intervalZ ?? 1.645;
  const minHalfWidth = opts.minHalfWidth ?? 0;
  if (window < 1) throw new RangeError('moving-average: window must be ≥ 1');

  return {
    kind: 'moving-average',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon, opts: callOpts } = args;
      assertValidSeries(series);
      if (series.points.length === 0) {
        throw new RangeError('moving-average: cannot forecast on empty series');
      }
      const alpha = callOpts?.alpha ?? 0.1;
      const ys = values(series);
      const effectiveWindow = Math.min(window, ys.length);
      const lastWindow = tail(series, effectiveWindow).map((p) => p.y);
      const mu = mean(lastWindow);

      // Heuristic interval based on within-window dispersion.
      const halfWidth = Math.max(
        minHalfWidth,
        z * stdDev(lastWindow.length > 1 ? lastWindow : ys),
      );

      const future = futureTimestamps(series, horizon.steps);
      const points = future.map(() => mu);
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
        modelKind:    'moving-average',
        modelVersion: 'moving-average-1',
        horizon,
        points:       intervals,
        generatedAt:  new Date().toISOString(),
        meta:         { window: effectiveWindow, halfWidth, mean: mu },
      });
    },
  };
}
