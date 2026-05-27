/**
 * Prophet / Prophet-Plus port — Python sidecar.
 *
 * References:
 *   Meta, "Prophet" — https://facebook.github.io/prophet/  (2017-2026)
 *   Meta Research, "Prophet-Plus" — https://research.facebook.com/blog/2023/10/prophet-plus/
 *
 * Decomposable additive model: y = trend + seasonality + holidays +
 * residual. Production strength is the interpretability of each
 * component — operators can read why the model went up or down.
 *
 * The sidecar contract is one POST per forecast with payload:
 *   { history: [{ ds, y }, ...], periods: number, freq: 'D' | 'W' | ... }
 * returning:
 *   { yhat: number[], yhat_lower_80: number[], yhat_upper_80: number[],
 *     yhat_lower_95: number[], yhat_upper_95: number[] }
 *
 * @module @borjie/forecasting/sota/models/prophet-port
 */

import {
  type ForecastHorizon,
  type IntervalBound,
  type SidecarPort,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'prophet-1.1';

const FREQ_MAP: Readonly<Record<TimeSeries['frequency'], string>> = Object.freeze({
  hourly: 'H',
  daily: 'D',
  weekly: 'W',
  monthly: 'MS',
  quarterly: 'QS',
  yearly: 'YS',
});

export interface ProphetPortOptions {
  readonly sidecar: SidecarPort;
  readonly logger?: SotaLogger;
}

interface ProphetSidecarResponse {
  readonly yhat: ReadonlyArray<number>;
  readonly yhat_lower_80?: ReadonlyArray<number>;
  readonly yhat_upper_80?: ReadonlyArray<number>;
  readonly yhat_lower_95?: ReadonlyArray<number>;
  readonly yhat_upper_95?: ReadonlyArray<number>;
}

function isProphetResponse(value: unknown): value is ProphetSidecarResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['yhat']);
}

export function createProphetForecaster(
  opts: ProphetPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  return {
    model: 'prophet',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const payload = {
        history: series.points.map((p) => ({ ds: p.t, y: p.y })),
        periods: horizon.steps,
        freq: FREQ_MAP[series.frequency],
      };
      let raw: Readonly<Record<string, unknown>>;
      try {
        raw = await opts.sidecar.invoke({ model: 'prophet', payload });
      } catch (error) {
        logger.error('prophet.sidecar.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('prophet: sidecar invocation failed');
      }
      if (!isProphetResponse(raw)) {
        throw new Error('prophet: malformed sidecar response');
      }
      const point = [...raw.yhat];
      if (point.length !== horizon.steps) {
        throw new Error(
          `prophet: response length ${point.length} != horizon ${horizon.steps}`,
        );
      }
      return {
        seriesId: series.id,
        model: 'prophet',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: band(point, raw.yhat_lower_80, raw.yhat_upper_80),
        intervals_95: band(point, raw.yhat_lower_95, raw.yhat_upper_95),
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

function band(
  point: ReadonlyArray<number>,
  lower?: ReadonlyArray<number>,
  upper?: ReadonlyArray<number>,
): ReadonlyArray<IntervalBound> {
  return point.map((p, i) => ({
    step: i + 1,
    lower: lower?.[i] ?? p,
    upper: upper?.[i] ?? p,
  }));
}
