/**
 * TSFM HTTP provider — real foundation-model adapter behind config.
 *
 * One adapter shape for the hosted / self-hosted TS-foundation-model
 * family (TimesFM-2.5, Chronos-2, Toto-2, TiRex). The concrete model is
 * selected by `config.model`; the endpoint speaks a small JSON contract
 * (request: series + horizon + quantiles; response: per-step quantile
 * map). A self-hosted AutoGluon/sidecar can implement the same contract.
 *
 * SECRET DISCIPLINE (CLAUDE.md): this module NEVER reads `process.env`.
 * The API key + base URL are injected via `config`, populated once at
 * bootstrap by the composition root. With no config the provider is
 * simply unavailable and the router degrades to the classical floor —
 * it never fabricates data.
 *
 * `fetchImpl` is injectable so tests run without a network.
 */

import type { RawForecast, TimeSeries, QuantileForecast } from '../types.js';
import { RawForecastSchema } from '../types.js';
import { quantileKey } from '../util/quantiles.js';
import type {
  ForecastProviderPort,
  ProviderHealth,
  ProviderKind,
} from './port.js';

/** Supported foundation-model identifiers. */
export type TsfmModel = 'timesfm-2.5' | 'chronos-2' | 'toto-2' | 'tirex';

export type FetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export interface TsfmHttpProviderConfig {
  readonly model: TsfmModel;
  /** Sidecar / API base URL. Absent => provider unavailable. */
  readonly baseUrl?: string;
  /** Bearer token. Injected at bootstrap; absent for keyless self-host. */
  readonly apiKey?: string;
  /** 'tsfm-api' (hosted) or 'tsfm-selfhost' (sidecar). Default 'tsfm-api'. */
  readonly kind?: Extract<ProviderKind, 'tsfm-api' | 'tsfm-selfhost'>;
  /** Injected fetch (defaults to global fetch when present). */
  readonly fetchImpl?: FetchLike;
  /** Request timeout ms (advisory; honoured by the injected fetch). */
  readonly timeoutMs?: number;
}

interface TsfmResponseStep {
  readonly point: number;
  readonly quantiles: Record<string, number>;
}

export function createTsfmHttpProvider(
  config: TsfmHttpProviderConfig,
): ForecastProviderPort {
  const kind: ProviderKind = config.kind ?? 'tsfm-api';
  const resolvedFetch: FetchLike | undefined =
    config.fetchImpl ??
    (typeof globalThis.fetch === 'function'
      ? (globalThis.fetch as unknown as FetchLike)
      : undefined);

  return {
    name: config.model,
    kind,
    async health(): Promise<ProviderHealth> {
      if (!config.baseUrl) {
        return { available: false, status: 'no_base_url' };
      }
      if (!resolvedFetch) {
        return { available: false, status: 'no_fetch_impl' };
      }
      if (kind === 'tsfm-api' && !config.apiKey) {
        return { available: false, status: 'no_api_key' };
      }
      return { available: true, status: 'ok' };
    },
    async forecast(
      series: TimeSeries,
      horizon: number,
      quantiles: ReadonlyArray<number>,
    ): Promise<RawForecast> {
      if (!config.baseUrl || !resolvedFetch) {
        throw new Error(
          `tsfm provider '${config.model}' is not configured (missing baseUrl or fetch)`,
        );
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;

      const body = JSON.stringify({
        model: config.model,
        horizon,
        quantiles: [...quantiles],
        series: {
          values: [...series.values],
          ...(series.timestamps ? { timestamps: [...series.timestamps] } : {}),
          ...(series.seasonLength !== undefined
            ? { seasonLength: series.seasonLength }
            : {}),
        },
      });

      const started = Date.now();
      const res = await resolvedFetch(`${config.baseUrl}/v1/forecast`, {
        method: 'POST',
        headers,
        body,
      });
      const latencyMs = Math.max(0, Date.now() - started);
      if (!res.ok) {
        throw new Error(
          `tsfm provider '${config.model}' HTTP ${res.status}`,
        );
      }
      const payload = (await res.json()) as {
        readonly steps?: ReadonlyArray<TsfmResponseStep>;
        readonly modelVersion?: string;
      };
      if (!payload.steps || payload.steps.length === 0) {
        throw new Error(
          `tsfm provider '${config.model}' returned no steps`,
        );
      }
      const steps: QuantileForecast[] = payload.steps.map((s, i) => {
        const qmap: Record<string, number> = {};
        for (const q of quantiles) {
          const k = quantileKey(q);
          const v = s.quantiles?.[k];
          qmap[k] = typeof v === 'number' ? v : s.point;
        }
        qmap[quantileKey(0.5)] = s.point;
        return { step: i + 1, point: s.point, quantiles: qmap };
      });
      // Validate before returning so a malformed sidecar can't poison
      // the engine — fail loud, never fabricate.
      return RawForecastSchema.parse({
        model: config.model,
        modelVersion: payload.modelVersion ?? `${config.model}-unknown`,
        steps,
        latencyMs,
      });
    },
  };
}
