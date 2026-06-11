/**
 * Classical provider — the DEFAULT in-repo adapter.
 *
 * Wraps the pure classical floor (SeasonalNaive / ETS-Theta / Croston /
 * TSB) as a `ForecastProviderPort` so the whole engine runs with ZERO
 * API keys and zero network. It is the accuracy floor every other
 * provider must beat AND the rule-based decision input.
 *
 * Quantiles are produced WITHOUT a foundation model: the model emits a
 * point path, and a symmetric spread around the point is derived from
 * the in-sample residuals of a holdout fit, scaled per quantile by the
 * normal inverse-CDF. These are PRELIMINARY quantiles; the engine's
 * conformal wrapper re-calibrates them to a coverage guarantee, so this
 * spread is only a sensible prior — never the surfaced interval.
 *
 * Pure + deterministic (no Math.random, no Date.now in the numerics).
 */

import type { RawForecast, TimeSeries, QuantileForecast } from '../types.js';
import { quantileKey } from '../util/quantiles.js';
import type { ClassicalForecaster } from '../classical/types.js';
import { createSeasonalNaive } from '../classical/seasonal-naive.js';
import { createEtsTheta } from '../classical/ets-theta.js';
import { createTsb } from '../classical/croston-tsb.js';
import type { ForecastProviderPort, ProviderHealth } from './port.js';

/** Which classical sub-model to wrap. */
export type ClassicalMethod = 'seasonal_naive' | 'ets_theta' | 'tsb';

export interface ClassicalProviderConfig {
  readonly method?: ClassicalMethod;
  /** Season length passed to seasonal models. Default from the series. */
  readonly seasonLength?: number;
}

/**
 * Standard-normal inverse CDF (Acklam's rational approximation).
 * Deterministic; |error| < 1.15e-9. Used to scale the residual std to
 * a per-quantile spread for the preliminary (pre-conformal) interval.
 */
export function normInv(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
      a[5]!) *
      q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** Sample standard deviation of one-step in-sample residuals. */
function residualStd(
  model: ClassicalForecaster,
  history: ReadonlyArray<number>,
  seasonLength: number,
): number {
  const minTrain = Math.max(2, seasonLength + 1);
  if (history.length <= minTrain) return 0;
  const residuals: number[] = [];
  for (let t = minTrain; t < history.length; t++) {
    const train = history.slice(0, t);
    const yhat = model.forecast(train, 1)[0] as number;
    residuals.push((history[t] as number) - yhat);
  }
  if (residuals.length < 2) return 0;
  let m = 0;
  for (const r of residuals) m += r;
  m /= residuals.length;
  let v = 0;
  for (const r of residuals) v += (r - m) * (r - m);
  v /= residuals.length - 1;
  return Math.sqrt(v);
}

function buildModel(
  method: ClassicalMethod,
  seasonLength: number,
): ClassicalForecaster {
  switch (method) {
    case 'seasonal_naive':
      return createSeasonalNaive({ seasonLength });
    case 'ets_theta':
      return createEtsTheta();
    case 'tsb':
      return createTsb();
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

export function createClassicalProvider(
  config: ClassicalProviderConfig = {},
): ForecastProviderPort {
  const method = config.method ?? 'ets_theta';
  return {
    name: `classical:${method}`,
    kind: 'classical',
    async health(): Promise<ProviderHealth> {
      return { available: true, status: 'ok' };
    },
    async forecast(
      series: TimeSeries,
      horizon: number,
      quantiles: ReadonlyArray<number>,
    ): Promise<RawForecast> {
      const seasonLength = Math.max(
        1,
        Math.floor(config.seasonLength ?? series.seasonLength ?? 1),
      );
      const model = buildModel(method, seasonLength);
      const points = model.forecast(series.values, horizon);
      const sigma = residualStd(model, series.values, seasonLength);
      const steps: QuantileForecast[] = points.map((point, i) => {
        const qmap: Record<string, number> = {};
        // Variance grows ~sqrt(h) for a random-walk-like error process.
        const stepScale = sigma * Math.sqrt(i + 1);
        for (const q of quantiles) {
          qmap[quantileKey(q)] = point + normInv(q) * stepScale;
        }
        // Always include the median key.
        qmap[quantileKey(0.5)] = point;
        return { step: i + 1, point, quantiles: qmap };
      });
      return {
        model: model.name,
        modelVersion: model.version,
        steps,
        latencyMs: 0,
      };
    },
  };
}
