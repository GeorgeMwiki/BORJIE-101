/**
 * Amazon Chronos / Chronos-Bolt port.
 *
 * Reference: Ansari et al., "Chronos: Learning the Language of Time
 * Series", arXiv 2403.07815, 2024 — https://arxiv.org/abs/2403.07815
 * and amazon-science/chronos-forecasting on GitHub. Chronos-Bolt
 * (Amazon, 2025) is the distilled 250x faster variant; same I/O
 * shape.
 *
 * The host service decides where Chronos runs (Hugging Face
 * Inference, Amazon Bedrock, or a local TorchServe) — this port
 * only knows how to talk to a REST endpoint that returns
 * `{ point, quantiles: { '0.1': [...], '0.5': [...], '0.9': [...],
 *   '0.025': [...], '0.975': [...] } }`. The 80 % interval is the
 * [0.1, 0.9] quantile pair; the 95 % is [0.025, 0.975].
 *
 * @module @borjie/forecasting/sota/models/chronos-port
 */

import {
  type Fetcher,
  type ForecastHorizon,
  type IntervalBound,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'chronos-bolt-base-2025';
const DEFAULT_ENDPOINT_PATH = '/predict';

export interface ChronosPortOptions {
  readonly fetcher: Fetcher;
  readonly endpoint: string;
  readonly authToken?: string;
  readonly logger?: SotaLogger;
  readonly timeoutMs?: number;
}

interface ChronosResponse {
  readonly point: ReadonlyArray<number>;
  readonly quantiles?: Readonly<Record<string, ReadonlyArray<number>>>;
}

function isChronosResponse(value: unknown): value is ChronosResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['point']);
}

export function createChronosForecaster(
  opts: ChronosPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  return {
    model: 'chronos',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const url = opts.endpoint.endsWith(DEFAULT_ENDPOINT_PATH)
        ? opts.endpoint
        : `${opts.endpoint}${DEFAULT_ENDPOINT_PATH}`;
      const body = {
        inputs: series.points.map((p) => p.y),
        parameters: {
          prediction_length: horizon.steps,
          quantile_levels: [0.025, 0.1, 0.5, 0.9, 0.975],
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
      let response: Response;
      try {
        response = await opts.fetcher(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.authToken !== undefined
              ? { authorization: `Bearer ${opts.authToken}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        logger.error('chronos.fetch.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('chronos: fetch failed');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        logger.warn('chronos.fetch.non_ok', { status: response.status });
        throw new Error(`chronos: HTTP ${response.status}`);
      }
      const json: unknown = await response.json();
      if (!isChronosResponse(json)) {
        throw new Error('chronos: malformed response');
      }
      const point = [...json.point];
      if (point.length !== horizon.steps) {
        throw new Error(
          `chronos: response length ${point.length} != horizon ${horizon.steps}`,
        );
      }
      const q = json.quantiles ?? {};
      return {
        seriesId: series.id,
        model: 'chronos',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: quantileBand(point, q['0.1'], q['0.9']),
        intervals_95: quantileBand(point, q['0.025'], q['0.975']),
        generatedAtISO: new Date().toISOString(),
      };
    },
  };
}

function quantileBand(
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
