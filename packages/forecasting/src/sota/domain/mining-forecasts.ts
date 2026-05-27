/**
 * Mining-domain forecast wrappers — Mr. Mwikila.
 *
 * Wave SOTA-FORECAST. Six narrow APIs, each composes a default
 * ensemble over the SOTA model ports and produces a forecast plus a
 * human-readable narrative. Persona: Mr. Mwikila — Borjie's
 * autonomous Managing Director for Tanzanian mining operators.
 *
 *  - forecastGoldPrice         → LME/Kitco daily price
 *  - forecastProductionVolume  → per-pit daily tonnes ore
 *  - forecastRoyaltyRevenue    → monthly TRA royalty + clearing-fee
 *  - forecastDemand            → weekly off-take partner demand
 *  - forecastWorkforce         → weekly worker headcount
 *  - forecastFuelCost          → daily diesel cost
 *
 * Royalty revenue is special: it is a composition of price × volume
 * times the TRA royalty + clearing-fee bps. The 80 / 95 intervals on
 * royalty are propagated via deterministic Monte-Carlo over the
 * upstream price and volume intervals (seed 4221).
 *
 * @module @borjie/forecasting/sota/domain/mining-forecasts
 */

import { createNaiveLastForecaster, createNaiveSeasonalForecaster, createNaiveMeanForecaster } from '../models/naive-baseline.js';
import { createEnsembleForecaster } from '../ensemble/ensemble.js';
import type {
  ForecastHorizon,
  ForecastResult,
  ForecastTarget,
  IntervalBound,
  MiningForecastNarrative,
  MiningForecastResult,
  SotaForecastingPort,
  TimeSeries,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Default ensembles per target — chosen so the floor model
// (naive-X) is always present and the test path is hermetic.
// ─────────────────────────────────────────────────────────────────────

export interface MiningForecastDeps {
  /** Optional foundation-model forecasters to mix in. */
  readonly timegpt?: SotaForecastingPort;
  readonly chronos?: SotaForecastingPort;
  readonly moirai?: SotaForecastingPort;
  readonly prophet?: SotaForecastingPort;
  readonly arima?: SotaForecastingPort;
  readonly nbeats?: SotaForecastingPort;
}

function defaultEnsemble(
  target: ForecastTarget,
  deps: MiningForecastDeps,
): SotaForecastingPort {
  // Each target prefers a different ensemble; if the foundation-model
  // adapter is unavailable, the naive baselines stand alone.
  const naiveSeasonal = createNaiveSeasonalForecaster();
  const naiveLast = createNaiveLastForecaster();
  const naiveMean = createNaiveMeanForecaster();
  switch (target) {
    case 'gold_price': {
      const members = [
        ...(deps.timegpt ? [{ forecaster: deps.timegpt, weight: 0.45 }] : []),
        ...(deps.chronos ? [{ forecaster: deps.chronos, weight: 0.35 }] : []),
        { forecaster: naiveSeasonal, weight: deps.timegpt && deps.chronos ? 0.2 : 1 },
      ];
      return createEnsembleForecaster({
        members: normalize(members),
        versionLabel: 'ensemble:gold_price',
      });
    }
    case 'production_volume': {
      const members = [
        ...(deps.chronos ? [{ forecaster: deps.chronos, weight: 0.4 }] : []),
        ...(deps.nbeats ? [{ forecaster: deps.nbeats, weight: 0.35 }] : []),
        { forecaster: naiveSeasonal, weight: deps.chronos && deps.nbeats ? 0.25 : 1 },
      ];
      return createEnsembleForecaster({
        members: normalize(members),
        versionLabel: 'ensemble:production_volume',
      });
    }
    case 'demand': {
      const members = [
        ...(deps.prophet ? [{ forecaster: deps.prophet, weight: 0.5 }] : []),
        ...(deps.arima ? [{ forecaster: deps.arima, weight: 0.3 }] : []),
        { forecaster: naiveSeasonal, weight: deps.prophet && deps.arima ? 0.2 : 1 },
      ];
      return createEnsembleForecaster({
        members: normalize(members),
        versionLabel: 'ensemble:demand',
      });
    }
    case 'workforce': {
      const members = [
        ...(deps.prophet ? [{ forecaster: deps.prophet, weight: 0.5 }] : []),
        { forecaster: naiveMean, weight: deps.prophet ? 0.5 : 1 },
      ];
      return createEnsembleForecaster({
        members: normalize(members),
        versionLabel: 'ensemble:workforce',
      });
    }
    case 'fuel': {
      const members = [
        ...(deps.chronos ? [{ forecaster: deps.chronos, weight: 0.5 }] : []),
        ...(deps.arima ? [{ forecaster: deps.arima, weight: 0.3 }] : []),
        { forecaster: naiveLast, weight: deps.chronos && deps.arima ? 0.2 : 1 },
      ];
      return createEnsembleForecaster({
        members: normalize(members),
        versionLabel: 'ensemble:fuel',
      });
    }
    case 'royalty': {
      // Royalty is a composition — not a standalone series forecaster.
      // The wrapper below handles it directly.
      return createEnsembleForecaster({
        members: [{ forecaster: naiveLast, weight: 1 }],
        versionLabel: 'ensemble:royalty-trivial',
      });
    }
    default: {
      const ex: never = target;
      throw new Error(`unsupported target ${String(ex)}`);
    }
  }
}

function normalize(
  members: ReadonlyArray<{ forecaster: SotaForecastingPort; weight: number }>,
): ReadonlyArray<{ forecaster: SotaForecastingPort; weight: number }> {
  const sum = members.reduce((acc, m) => acc + m.weight, 0);
  if (sum === 0) return members;
  return members.map((m) => ({ ...m, weight: m.weight / sum }));
}

// ─────────────────────────────────────────────────────────────────────
// Narrative helpers
// ─────────────────────────────────────────────────────────────────────

function changePct(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / Math.abs(from)) * 100;
}

function buildNarrative(args: {
  readonly target: ForecastTarget;
  readonly series: TimeSeries;
  readonly forecast: ForecastResult;
  readonly unit?: string;
}): MiningForecastNarrative {
  const last = args.series.points[args.series.points.length - 1]?.y ?? 0;
  const finalPoint = args.forecast.point[args.forecast.point.length - 1] ?? 0;
  const pct = changePct(last, finalPoint);
  const finalBand = args.forecast.intervals_95[args.forecast.intervals_95.length - 1];
  const unit = args.unit ?? args.series.unit ?? '';
  const direction = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const severity: MiningForecastNarrative['severity'] =
    Math.abs(pct) >= 15
      ? 'high'
      : Math.abs(pct) >= 5
        ? 'medium'
        : Math.abs(pct) >= 1
          ? 'low'
          : 'info';
  const lower = finalBand?.lower ?? finalPoint;
  const upper = finalBand?.upper ?? finalPoint;
  const headline = `${args.target.replace(/_/g, ' ')} ${direction} ${Math.abs(pct).toFixed(1)}% over next ${args.forecast.horizon.steps} steps`;
  const detail =
    `Mr. Mwikila forecasts ${unit ? unit + ' ' : ''}${finalPoint.toFixed(2)} ` +
    `at horizon step ${args.forecast.horizon.steps} ` +
    `(95% band ${lower.toFixed(2)} - ${upper.toFixed(2)}). ` +
    `Model: ${args.forecast.model} (${args.forecast.modelVersion}).`;
  return { headline, detail, severity };
}

// ─────────────────────────────────────────────────────────────────────
// Public wrappers
// ─────────────────────────────────────────────────────────────────────

export interface ForecastGoldPriceInput {
  readonly series: TimeSeries;
  readonly horizon: ForecastHorizon;
  readonly deps?: MiningForecastDeps;
  readonly sources?: ReadonlyArray<string>;
}

export async function forecastGoldPrice(
  input: ForecastGoldPriceInput,
): Promise<MiningForecastResult> {
  const ensemble = defaultEnsemble('gold_price', input.deps ?? {});
  const forecast = await ensemble.predict({
    series: input.series,
    horizon: input.horizon,
  });
  return {
    target: 'gold_price',
    forecast,
    narrative: buildNarrative({
      target: 'gold_price',
      series: input.series,
      forecast,
      unit: 'USD/oz',
    }),
    sources: input.sources ?? ['lme-rest'],
  };
}

export interface ForecastProductionVolumeInput {
  readonly pitId: string;
  readonly series: TimeSeries;
  readonly horizon: ForecastHorizon;
  readonly deps?: MiningForecastDeps;
}

export async function forecastProductionVolume(
  input: ForecastProductionVolumeInput,
): Promise<MiningForecastResult> {
  const ensemble = defaultEnsemble('production_volume', input.deps ?? {});
  const forecast = await ensemble.predict({
    series: input.series,
    horizon: input.horizon,
  });
  return {
    target: 'production_volume',
    forecast,
    narrative: buildNarrative({
      target: 'production_volume',
      series: input.series,
      forecast,
      unit: 'tonnes/day',
    }),
    sources: [`pit:${input.pitId}`],
  };
}

export interface ForecastDemandInput {
  readonly series: TimeSeries;
  readonly horizon: ForecastHorizon;
  readonly deps?: MiningForecastDeps;
}

export async function forecastDemand(
  input: ForecastDemandInput,
): Promise<MiningForecastResult> {
  const ensemble = defaultEnsemble('demand', input.deps ?? {});
  const forecast = await ensemble.predict({
    series: input.series,
    horizon: input.horizon,
  });
  return {
    target: 'demand',
    forecast,
    narrative: buildNarrative({
      target: 'demand',
      series: input.series,
      forecast,
      unit: 'tonnes/week',
    }),
    sources: ['off-take-partner-feed'],
  };
}

export interface ForecastWorkforceInput {
  readonly series: TimeSeries;
  readonly horizon: ForecastHorizon;
  readonly deps?: MiningForecastDeps;
}

export async function forecastWorkforce(
  input: ForecastWorkforceInput,
): Promise<MiningForecastResult> {
  const ensemble = defaultEnsemble('workforce', input.deps ?? {});
  const forecast = await ensemble.predict({
    series: input.series,
    horizon: input.horizon,
  });
  return {
    target: 'workforce',
    forecast,
    narrative: buildNarrative({
      target: 'workforce',
      series: input.series,
      forecast,
      unit: 'workers',
    }),
    sources: ['hris'],
  };
}

export interface ForecastFuelCostInput {
  readonly series: TimeSeries;
  readonly horizon: ForecastHorizon;
  readonly deps?: MiningForecastDeps;
}

export async function forecastFuelCost(
  input: ForecastFuelCostInput,
): Promise<MiningForecastResult> {
  const ensemble = defaultEnsemble('fuel', input.deps ?? {});
  const forecast = await ensemble.predict({
    series: input.series,
    horizon: input.horizon,
  });
  return {
    target: 'fuel',
    forecast,
    narrative: buildNarrative({
      target: 'fuel',
      series: input.series,
      forecast,
      unit: 'TZS/L',
    }),
    sources: ['fuel-procurement-feed'],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Royalty revenue — composition forecast
// ─────────────────────────────────────────────────────────────────────

const ROYALTY_MC_SEED = 4221;
const ROYALTY_MC_DRAWS = 10_000;

/**
 * Deterministic Linear Congruential Generator (Numerical Recipes).
 * Same seed → same draws → reproducible intervals.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalSample(rand: () => number): number {
  // Box-Muller. Returns a single N(0, 1) draw per call.
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface ForecastRoyaltyRevenueInput {
  readonly priceForecast: ForecastResult;
  readonly volumeForecast: ForecastResult;
  readonly royaltyRateBps: number; // e.g. 600 = 6.00 %
  readonly clearingFeeBps: number; // e.g. 100 = 1.00 %
  readonly tenantId: string;
}

/**
 * Compute royalty + clearing fee revenue per step.
 *
 * Per step:
 *   revenue = price · volume · (royaltyRateBps + clearingFeeBps) / 10000
 *
 * Intervals are propagated by Monte-Carlo on the joint normal
 * approximation of (price, volume) inside their respective 95 %
 * bands, with sigma_price ≈ (upper - lower) / (2 · z_95), same for
 * sigma_volume. Seed is fixed at 4221 so the test is hermetic.
 */
export function forecastRoyaltyRevenue(
  input: ForecastRoyaltyRevenueInput,
): MiningForecastResult {
  if (input.priceForecast.horizon.steps !== input.volumeForecast.horizon.steps) {
    throw new RangeError(
      'forecastRoyaltyRevenue: price and volume horizons must match',
    );
  }
  if (input.royaltyRateBps < 0 || input.royaltyRateBps > 10_000) {
    throw new RangeError(
      `forecastRoyaltyRevenue: royaltyRateBps must be in [0, 10000]`,
    );
  }
  if (input.clearingFeeBps < 0 || input.clearingFeeBps > 10_000) {
    throw new RangeError(
      `forecastRoyaltyRevenue: clearingFeeBps must be in [0, 10000]`,
    );
  }
  const totalBps = input.royaltyRateBps + input.clearingFeeBps;
  const rate = totalBps / 10_000;
  const steps = input.priceForecast.horizon.steps;
  const Z_95 = 1.959963984540054;
  const rand = lcg(ROYALTY_MC_SEED);
  const point: number[] = [];
  const i80: IntervalBound[] = [];
  const i95: IntervalBound[] = [];
  for (let s = 0; s < steps; s += 1) {
    const pPoint = input.priceForecast.point[s] ?? 0;
    const vPoint = input.volumeForecast.point[s] ?? 0;
    const pBand95 = input.priceForecast.intervals_95[s];
    const vBand95 = input.volumeForecast.intervals_95[s];
    const sigmaPrice = pBand95 ? Math.max(0, (pBand95.upper - pBand95.lower) / (2 * Z_95)) : 0;
    const sigmaVolume = vBand95 ? Math.max(0, (vBand95.upper - vBand95.lower) / (2 * Z_95)) : 0;
    const draws: number[] = [];
    for (let d = 0; d < ROYALTY_MC_DRAWS; d += 1) {
      const pSample = pPoint + sigmaPrice * normalSample(rand);
      const vSample = vPoint + sigmaVolume * normalSample(rand);
      draws.push(pSample * vSample * rate);
    }
    draws.sort((a, b) => a - b);
    const median = draws[Math.floor(ROYALTY_MC_DRAWS / 2)] ?? 0;
    const lo80 = draws[Math.floor(ROYALTY_MC_DRAWS * 0.1)] ?? 0;
    const hi80 = draws[Math.floor(ROYALTY_MC_DRAWS * 0.9)] ?? 0;
    const lo95 = draws[Math.floor(ROYALTY_MC_DRAWS * 0.025)] ?? 0;
    const hi95 = draws[Math.floor(ROYALTY_MC_DRAWS * 0.975)] ?? 0;
    point.push(median);
    i80.push({ step: s + 1, lower: lo80, upper: hi80 });
    i95.push({ step: s + 1, lower: lo95, upper: hi95 });
  }
  const forecast: ForecastResult = {
    seriesId: `royalty:${input.tenantId}`,
    model: 'ensemble',
    modelVersion: 'royalty-mc-2026.05.27',
    horizon: input.priceForecast.horizon,
    point,
    intervals_80: i80,
    intervals_95: i95,
    generatedAtISO: new Date().toISOString(),
    meta: {
      royaltyRateBps: input.royaltyRateBps,
      clearingFeeBps: input.clearingFeeBps,
      mcSeed: ROYALTY_MC_SEED,
      mcDraws: ROYALTY_MC_DRAWS,
    },
  };
  return {
    target: 'royalty',
    forecast,
    narrative: {
      headline: `Royalty revenue forecast over ${steps} steps`,
      detail:
        `Mr. Mwikila composes price × volume × ${(rate * 100).toFixed(2)}% rate ` +
        `via Monte-Carlo (${ROYALTY_MC_DRAWS} draws, seed ${ROYALTY_MC_SEED}).`,
      severity: 'info',
    },
    sources: ['price-forecast', 'volume-forecast', 'tra-royalty-policy'],
  };
}
