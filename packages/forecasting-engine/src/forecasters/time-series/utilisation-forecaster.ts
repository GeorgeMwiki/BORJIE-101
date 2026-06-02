/**
 * UtilisationForecaster — Empirical Bayes per micro-market.
 *
 * Beta-Binomial conjugate posterior. Prior is fit from the cohort
 * mean + variance across all micro-markets (Method-of-Moments). For
 * each market we then update the posterior with that market's
 * in-production / total counts.
 *
 * NOTE: file renamed from `occupancy-forecaster.ts`; deprecated
 * `*Occupancy*` aliases are retained for any in-flight importer.
 */

import type { ForecastBand, FittedModel } from '../../types.js';

export interface UtilisationObservation {
  readonly microMarketId: string;
  readonly inProduction: number;
  readonly total: number;
}

/** @deprecated Use {@link UtilisationObservation}. */
export type OccupancyObservation = UtilisationObservation;

export interface UtilisationParams {
  readonly priorAlpha: number;
  readonly priorBeta: number;
  readonly posteriorByMarket: ReadonlyMap<
    string,
    { alpha: number; beta: number }
  >;
}

/** @deprecated Use {@link UtilisationParams}. */
export type OccupancyParams = UtilisationParams;

export function fitUtilisation(
  obs: ReadonlyArray<UtilisationObservation>,
): FittedModel<UtilisationParams> {
  if (obs.length === 0) {
    throw new Error('Need at least 1 observation to fit utilisation');
  }
  // Per-market raw rates
  const rates = obs
    .filter((o) => o.total > 0)
    .map((o) => o.inProduction / o.total);
  const mean = rates.reduce((s, r) => s + r, 0) / Math.max(1, rates.length);
  const variance =
    rates.reduce((s, r) => s + (r - mean) * (r - mean), 0) /
    Math.max(1, rates.length);

  // Method-of-Moments for Beta prior
  // alpha + beta = mean*(1-mean)/var - 1
  let sumAB: number;
  if (variance <= 0 || variance >= mean * (1 - mean)) {
    sumAB = 10; // fallback weak prior
  } else {
    sumAB = (mean * (1 - mean)) / variance - 1;
  }
  const priorAlpha = Math.max(0.5, mean * sumAB);
  const priorBeta = Math.max(0.5, (1 - mean) * sumAB);

  const posteriorByMarket = new Map<
    string,
    { alpha: number; beta: number }
  >();
  obs.forEach((o) => {
    posteriorByMarket.set(o.microMarketId, {
      alpha: priorAlpha + o.inProduction,
      beta: priorBeta + (o.total - o.inProduction),
    });
  });

  // Residual std under Beta-Binomial: sqrt(var(rate))
  const residualStd = Math.sqrt(Math.max(1e-6, variance));

  return {
    params: { priorAlpha, priorBeta, posteriorByMarket },
    residualStd,
    sampleSize: obs.length,
  };
}

/** @deprecated Use {@link fitUtilisation}. */
export const fitOccupancy = fitUtilisation;

export function forecastUtilisation(
  model: FittedModel<UtilisationParams>,
  microMarketId: string,
  horizonDays: number,
  nowMs: number = Date.now(),
): ReadonlyArray<ForecastBand> {
  const post =
    model.params.posteriorByMarket.get(microMarketId) ?? {
      alpha: model.params.priorAlpha,
      beta: model.params.priorBeta,
    };
  const mean = post.alpha / (post.alpha + post.beta);
  // Variance of Beta(a,b)
  const variance =
    (post.alpha * post.beta) /
    ((post.alpha + post.beta) ** 2 * (post.alpha + post.beta + 1));
  const sigma = Math.sqrt(variance);
  const dayMs = 24 * 60 * 60 * 1000;
  const Z = 1.2816;
  const out: ForecastBand[] = [];
  for (let h = 1; h <= horizonDays; h += 1) {
    // Posterior is the same each day (no time-decay in this version)
    out.push({
      t: nowMs + h * dayMs,
      p10: Math.max(0, mean - Z * sigma),
      p50: mean,
      p90: Math.min(1, mean + Z * sigma),
    });
  }
  return out;
}

/** @deprecated Use {@link forecastUtilisation}. */
export const forecastOccupancy = forecastUtilisation;

export function updateUtilisation(
  model: FittedModel<UtilisationParams>,
  obs: UtilisationObservation,
): FittedModel<UtilisationParams> {
  const next = new Map(model.params.posteriorByMarket);
  const prev = next.get(obs.microMarketId) ?? {
    alpha: model.params.priorAlpha,
    beta: model.params.priorBeta,
  };
  next.set(obs.microMarketId, {
    alpha: prev.alpha + obs.inProduction,
    beta: prev.beta + (obs.total - obs.inProduction),
  });
  return {
    params: {
      priorAlpha: model.params.priorAlpha,
      priorBeta: model.params.priorBeta,
      posteriorByMarket: next,
    },
    residualStd: model.residualStd,
    sampleSize: model.sampleSize + 1,
  };
}

/** @deprecated Use {@link updateUtilisation}. */
export const updateOccupancy = updateUtilisation;
