/**
 * Salesforce MOIRAI / MOIRAI-MoE port.
 *
 * References:
 *   Woo et al., "Unified Training of Universal Time Series Forecasting
 *   Transformers", arXiv 2402.02592 (2024) —
 *   https://arxiv.org/abs/2402.02592
 *   Liu et al., "MOIRAI-MoE: Empowering Time Series Foundation Models
 *   with Sparse Mixture of Experts", arXiv 2410.10469 (2024) —
 *   https://arxiv.org/abs/2410.10469
 *
 * MOIRAI is a masked-encoder universal forecaster; MOIRAI-MoE adds
 * sparse experts. The HF Inference contract returns a samples tensor
 * `samples[num_samples][prediction_length]` from which we derive the
 * point (median), 80 % (10/90 quantiles), and 95 % (2.5/97.5
 * quantiles).
 *
 * @module @borjie/forecasting/sota/models/moirai-port
 */

import {
  type Fetcher,
  type ForecastHorizon,
  type IntervalBound,
  type SotaForecastingPort,
  type TimeSeries,
} from '../types.js';
import { NOOP_SOTA_LOGGER, type SotaLogger } from '../logger.js';

const MODEL_VERSION = 'moirai-moe-2024';

export interface MoiraiPortOptions {
  readonly fetcher: Fetcher;
  readonly endpoint: string;
  readonly authToken?: string;
  readonly logger?: SotaLogger;
  readonly timeoutMs?: number;
  readonly numSamples?: number;
}

interface MoiraiResponse {
  /** Shape: [numSamples][predictionLength]. */
  readonly samples: ReadonlyArray<ReadonlyArray<number>>;
}

function isMoiraiResponse(value: unknown): value is MoiraiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['samples']) && Array.isArray(v['samples'][0]);
}

/**
 * Stable, deterministic quantile via interpolation. Sorted-array
 * input; quantile q in [0, 1]. Matches numpy/pandas linear interpolation.
 */
function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function createMoiraiForecaster(
  opts: MoiraiPortOptions,
): SotaForecastingPort {
  const logger = opts.logger ?? NOOP_SOTA_LOGGER;
  const numSamples = opts.numSamples ?? 100;
  return {
    model: 'moirai',
    modelVersion: MODEL_VERSION,
    async predict(args) {
      const horizon: ForecastHorizon = args.horizon;
      const series: TimeSeries = args.series;
      const body = {
        inputs: series.points.map((p) => p.y),
        parameters: {
          prediction_length: horizon.steps,
          num_samples: numSamples,
          freq: series.frequency,
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
      let response: Response;
      try {
        response = await opts.fetcher(opts.endpoint, {
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
        logger.error('moirai.fetch.error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('moirai: fetch failed');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        logger.warn('moirai.fetch.non_ok', { status: response.status });
        throw new Error(`moirai: HTTP ${response.status}`);
      }
      const json: unknown = await response.json();
      if (!isMoiraiResponse(json)) {
        throw new Error('moirai: malformed response');
      }
      const samples = json.samples;
      if (samples.length === 0 || samples[0]!.length !== horizon.steps) {
        throw new Error(
          `moirai: response shape mismatch (samples=${samples.length}, len=${samples[0]?.length})`,
        );
      }
      // Compute per-step point + bands from the sample tensor.
      const point: number[] = [];
      const i80: IntervalBound[] = [];
      const i95: IntervalBound[] = [];
      for (let step = 0; step < horizon.steps; step += 1) {
        const col: number[] = [];
        for (let s = 0; s < samples.length; s += 1) {
          col.push(samples[s]![step]!);
        }
        col.sort((a, b) => a - b);
        const median = quantile(col, 0.5);
        point.push(median);
        i80.push({
          step: step + 1,
          lower: quantile(col, 0.1),
          upper: quantile(col, 0.9),
        });
        i95.push({
          step: step + 1,
          lower: quantile(col, 0.025),
          upper: quantile(col, 0.975),
        });
      }
      return {
        seriesId: series.id,
        model: 'moirai',
        modelVersion: MODEL_VERSION,
        horizon,
        point,
        intervals_80: i80,
        intervals_95: i95,
        generatedAtISO: new Date().toISOString(),
        meta: { numSamples },
      };
    },
  };
}
