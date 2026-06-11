/**
 * ForecastProviderPort — the single swappable backend interface.
 *
 * Every forecasting backend (the classical floor, a self-hosted TSFM
 * sidecar, a hosted TSFM HTTP API) implements this one port so the
 * router can pick per-series by data regime, never by leaderboard rank.
 *
 * A provider emits a `RawForecast` (uncalibrated quantiles). The
 * conformal wrapper turns those into calibrated `PredictionInterval`s —
 * raw provider quantiles are NEVER surfaced as decision intervals
 * (CLAUDE.md rail).
 */

import type { RawForecast, TimeSeries } from '../types.js';

/** Kind of backend — drives routing + cost/health telemetry. */
export type ProviderKind =
  | 'classical' // pure in-repo statistical floor
  | 'tsfm-selfhost' // self-hosted foundation-model sidecar
  | 'tsfm-api'; // hosted foundation-model HTTP API

export interface ProviderHealth {
  /** True iff the provider is reachable + configured. */
  readonly available: boolean;
  /** Human-readable status, e.g. 'ok' | 'no_api_key' | 'sidecar_unreachable'. */
  readonly status: string;
}

export interface ForecastProviderPort {
  /** Stable provider name, e.g. 'classical' | 'chronos-2'. */
  readonly name: string;
  readonly kind: ProviderKind;
  /**
   * Whether this provider can be invoked right now (config present,
   * sidecar reachable). The router skips unavailable providers and
   * NEVER fabricates — it degrades to the classical floor instead.
   */
  health(): Promise<ProviderHealth>;
  /**
   * Produce an uncalibrated quantile forecast.
   * @param series   history to extrapolate from
   * @param horizon  steps ahead (>=1)
   * @param quantiles quantile levels to emit (median always included)
   */
  forecast(
    series: TimeSeries,
    horizon: number,
    quantiles: ReadonlyArray<number>,
  ): Promise<RawForecast>;
}
