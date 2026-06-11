/**
 * Rolling-origin backtest — the floor-beating gate's evidence engine.
 *
 * Splits the history into an expanding-window train set and a held-out
 * tail, scores each provider's one-step (or multi-step) forecast on the
 * tail with MASE, and reports a comparable accuracy number. The router
 * uses these scores to REJECT any model that fails to beat the
 * classical floor on held-out data — never on a leaderboard rank.
 *
 * Pure; deterministic given deterministic providers. Async only because
 * providers are async ports.
 */

import type { ForecastProviderPort } from '../providers/port.js';
import type { TimeSeries } from '../types.js';
import { mase, quantileKey } from '../util/quantiles.js';

export interface BacktestConfig {
  /** Number of held-out points at the tail. Default min(8, floor(n/4)). */
  readonly holdout?: number;
  /** Quantiles to request from the provider (median always used). */
  readonly quantiles?: ReadonlyArray<number>;
}

export interface BacktestScore {
  readonly provider: string;
  /** Mean Absolute Scaled Error on the held-out tail. Lower is better. */
  readonly mase: number;
  /** Number of held-out points scored. */
  readonly points: number;
}

/**
 * Score one provider on a single expanding-window split (train = head,
 * test = held-out tail). Returns MASE; Infinity when the series is too
 * short to backtest.
 */
export async function backtestProvider(
  provider: ForecastProviderPort,
  series: TimeSeries,
  config: BacktestConfig = {},
): Promise<BacktestScore> {
  const n = series.values.length;
  const seasonLength = Math.max(1, Math.floor(series.seasonLength ?? 1));
  const holdout = Math.max(
    1,
    Math.min(config.holdout ?? Math.min(8, Math.floor(n / 4)), n - seasonLength - 1),
  );
  if (n - holdout <= seasonLength + 1 || holdout < 1) {
    return { provider: provider.name, mase: Number.POSITIVE_INFINITY, points: 0 };
  }
  const train = series.values.slice(0, n - holdout);
  const actuals = series.values.slice(n - holdout);
  const quantiles = config.quantiles ?? [0.5];

  const trainSeries: TimeSeries = {
    ...series,
    values: train,
    ...(series.timestamps
      ? { timestamps: series.timestamps.slice(0, n - holdout) }
      : {}),
  };
  const raw = await provider.forecast(trainSeries, holdout, quantiles);
  const medianKey = quantileKey(0.5);
  const forecasts = raw.steps.map((s) => s.quantiles[medianKey] ?? s.point);
  const score = mase(actuals, forecasts, train, seasonLength);
  return {
    provider: provider.name,
    mase: score,
    points: Math.min(actuals.length, forecasts.length),
  };
}

/**
 * Decide whether a candidate beats the floor on held-out data.
 * A candidate beats the floor iff its MASE is strictly lower than the
 * floor's by at least `margin` (default 0 — must be strictly better).
 * A non-finite candidate score never beats the floor.
 */
export function beatsFloor(
  candidate: BacktestScore,
  floor: BacktestScore,
  margin = 0,
): boolean {
  if (!Number.isFinite(candidate.mase)) return false;
  if (!Number.isFinite(floor.mase)) return false;
  return candidate.mase < floor.mase - margin;
}
