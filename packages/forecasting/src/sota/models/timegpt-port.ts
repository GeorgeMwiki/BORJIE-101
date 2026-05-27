/**
 * Nixtla TimeGPT-1 port.
 *
 * Wave SOTA-FORECAST. Reference:
 *   https://docs.nixtla.io/  (Nixtla, "TimeGPT-1 documentation",
 *   2024-2026). Zero-shot inference via REST; the Nixtla API returns
 *   point + quantile bands {q-10, q-50, q-90, q-2.5, q-97.5}.
 *
 * This is a PORT — it does not embed the model. It speaks the
 * Nixtla REST contract via an injected `Fetcher` (so tests stub the
 * HTTP path with deterministic synthetic fixtures, and production
 * binds the real `fetch`). When the Fetcher returns a non-OK status
 * we fall back to a hard error so the ensemble dispatcher can pick a
 * sibling model — silent fallback would hide outages.
 *
 * @module @borjie/forecasting/sota/models/timegpt-port
 */

import {
  type Fetcher,
  type ForecastHorizon,
  type IntervalBound,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'timegpt-1';
const DEFAULT_BASE_URL = 'https://api.nixtla.io';

export interface TimeGptPortOptions {
  readonly fetcher: Fetcher;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly logger?: SotaLogger;
  readonly timeoutMs?: number;
}

interface TimeGptResponse {
  readonly value: ReadonlyArray<number>;
  readonly 'lo-80'?: ReadonlyArray<number>;
  readonly 'hi-80'?: ReadonlyArray<number>;
  readonly 'lo-95'?: ReadonlyArray<number>;
  readonly 'hi-95'?: ReadonlyArray<number>;
}

function isTimeGptResponse(value: unknown): value is TimeGptResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['value']);
}

export function createTimeGptForecaster(
  opts: TimeGptPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  return {
    model: 'timegpt',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const body = {
        series: {
          freq: series.frequency,
          values: series.points.map((p) => p.y),
          timestamps: series.points.map((p) => p.t),
        },
        horizon: horizon.steps,
        levels: [80, 95],
        ...(args.opts?.seasonality !== undefined
          ? { seasonality: args.opts.seasonality }
          : {}),
      };
      const controller = new AbortController();
      const timeoutMs = opts.timeoutMs ?? 20_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await opts.fetcher(`${baseUrl}/v2/forecast`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        logger.error('timegpt.fetch.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('timegpt: fetch failed');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        logger.warn('timegpt.fetch.non_ok', { status: response.status });
        throw new Error(`timegpt: HTTP ${response.status}`);
      }
      const json: unknown = await response.json();
      if (!isTimeGptResponse(json)) {
        throw new Error('timegpt: malformed response');
      }
      const point = [...json.value];
      if (point.length !== horizon.steps) {
        throw new Error(
          `timegpt: response length ${point.length} != horizon ${horizon.steps}`,
        );
      }
      return {
        seriesId: series.id,
        model: 'timegpt',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: bandsFromResponse(point, json['lo-80'], json['hi-80']),
        intervals_95: bandsFromResponse(point, json['lo-95'], json['hi-95']),
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

function bandsFromResponse(
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
