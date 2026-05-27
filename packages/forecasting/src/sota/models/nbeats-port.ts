/**
 * N-BEATS / N-HiTS port — neuralforecast sidecar.
 *
 * References:
 *   Oreshkin et al., "N-BEATS: Neural basis expansion analysis for
 *   interpretable time series forecasting", arXiv 1905.10437, ICLR
 *   2020 — https://arxiv.org/abs/1905.10437
 *   Challu et al., "N-HiTS: Neural Hierarchical Interpolation for
 *   Time Series Forecasting", arXiv 2201.12886, AAAI 2023 —
 *   https://arxiv.org/abs/2201.12886
 *
 * Pure-MLP deep models. Per-step champion on M4-Hourly and M5
 * long-horizon. The same neuralforecast sidecar serves both —
 * `variant` decides which architecture to instantiate.
 *
 * Sidecar contract:
 *   { values: number[], periods: number, variant: 'nbeats' | 'nhits',
 *     freq: string, levels?: [80, 95] }
 * returning:
 *   { forecast: number[], lo_80?: number[], hi_80?: number[],
 *     lo_95?: number[], hi_95?: number[] }
 *
 * @module @borjie/forecasting/sota/models/nbeats-port
 */

import {
  type ForecastHorizon,
  type IntervalBound,
  type SidecarPort,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'neuralforecast-nbeats-1.7';

export type NBeatsVariant = 'nbeats' | 'nhits';

export interface NBeatsPortOptions {
  readonly sidecar: SidecarPort;
  readonly variant?: NBeatsVariant;
  readonly logger?: SotaLogger;
}

interface NBeatsSidecarResponse {
  readonly forecast: ReadonlyArray<number>;
  readonly lo_80?: ReadonlyArray<number>;
  readonly hi_80?: ReadonlyArray<number>;
  readonly lo_95?: ReadonlyArray<number>;
  readonly hi_95?: ReadonlyArray<number>;
}

function isNBeatsResponse(value: unknown): value is NBeatsSidecarResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['forecast']);
}

export function createNBeatsForecaster(
  opts: NBeatsPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  const variant: NBeatsVariant = opts.variant ?? 'nhits';
  return {
    model: 'nbeats',
    modelVersion: `${MODEL_VERSION}/${variant}`,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const payload = {
        values: series.points.map((p) => p.y),
        timestamps: series.points.map((p) => p.t),
        periods: horizon.steps,
        variant,
        freq: series.frequency,
        levels: [80, 95],
      };
      let raw: Readonly<Record<string, unknown>>;
      try {
        raw = await opts.sidecar.invoke({ model: 'nbeats', payload });
      } catch (error) {
        logger.error('nbeats.sidecar.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('nbeats: sidecar invocation failed');
      }
      if (!isNBeatsResponse(raw)) {
        throw new Error('nbeats: malformed sidecar response');
      }
      const point = [...raw.forecast];
      if (point.length !== horizon.steps) {
        throw new Error(
          `nbeats: response length ${point.length} != horizon ${horizon.steps}`,
        );
      }
      return {
        seriesId: series.id,
        model: 'nbeats',
        modelVersion: `${MODEL_VERSION}/${variant}`,
        horizon,
        point,
        intervals_80: bandFromBounds(point, raw.lo_80, raw.hi_80),
        intervals_95: bandFromBounds(point, raw.lo_95, raw.hi_95),
        generatedAtISO: new Date().toISOString(),
        meta: { variant },
      };
    },
  };
}

function bandFromBounds(
  point: ReadonlyArray<number>,
  lo?: ReadonlyArray<number>,
  hi?: ReadonlyArray<number>,
): ReadonlyArray<IntervalBound> {
  return point.map((p, i) => ({
    step: i + 1,
    lower: lo?.[i] ?? p,
    upper: hi?.[i] ?? p,
  }));
}
