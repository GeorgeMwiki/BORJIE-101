/**
 * statsmodels ARIMA / SARIMA port — Python sidecar.
 *
 * Reference: statsmodels developers, "Time Series analysis (tsa)" —
 *   https://www.statsmodels.org/stable/tsa.html  (2010-2026).
 *
 * Classical Box-Jenkins workhorse. Strong on short-horizon, modest-
 * volatility series (weekly demand, monthly headcount). The sidecar
 * contract is:
 *   { values: number[], periods: number, order: [p,d,q],
 *     seasonal_order?: [P,D,Q,s], freq?: string }
 * returning:
 *   { forecast: number[], conf_int_80: [[lo, hi], ...],
 *     conf_int_95: [[lo, hi], ...] }
 *
 * @module @borjie/forecasting/sota/models/arima-port
 */

import {
  type ForecastHorizon,
  type IntervalBound,
  type SidecarPort,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'statsmodels-arima-0.14';

export interface ArimaPortOptions {
  readonly sidecar: SidecarPort;
  readonly logger?: SotaLogger;
  readonly order?: readonly [number, number, number];
  readonly seasonalOrder?: readonly [number, number, number, number];
}

interface ArimaSidecarResponse {
  readonly forecast: ReadonlyArray<number>;
  readonly conf_int_80?: ReadonlyArray<readonly [number, number]>;
  readonly conf_int_95?: ReadonlyArray<readonly [number, number]>;
}

function isArimaResponse(value: unknown): value is ArimaSidecarResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['forecast']);
}

export function createArimaForecaster(
  opts: ArimaPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  return {
    model: 'arima',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const payload = {
        values: series.points.map((p) => p.y),
        timestamps: series.points.map((p) => p.t),
        periods: horizon.steps,
        order: opts.order ?? [1, 1, 1],
        ...(opts.seasonalOrder !== undefined
          ? { seasonal_order: opts.seasonalOrder }
          : {}),
        freq: series.frequency,
      };
      let raw: Readonly<Record<string, unknown>>;
      try {
        raw = await opts.sidecar.invoke({ model: 'arima', payload });
      } catch (error) {
        logger.error('arima.sidecar.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('arima: sidecar invocation failed');
      }
      if (!isArimaResponse(raw)) {
        throw new Error('arima: malformed sidecar response');
      }
      const point = [...raw.forecast];
      if (point.length !== horizon.steps) {
        throw new Error(
          `arima: response length ${point.length} != horizon ${horizon.steps}`,
        );
      }
      return {
        seriesId: series.id,
        model: 'arima',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: pairsToBands(point, raw.conf_int_80),
        intervals_95: pairsToBands(point, raw.conf_int_95),
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

function pairsToBands(
  point: ReadonlyArray<number>,
  pairs?: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<IntervalBound> {
  return point.map((p, i) => {
    const pair = pairs?.[i];
    return {
      step: i + 1,
      lower: pair?.[0] ?? p,
      upper: pair?.[1] ?? p,
    };
  });
}
