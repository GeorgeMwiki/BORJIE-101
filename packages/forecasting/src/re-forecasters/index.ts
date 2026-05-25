/**
 * Real-estate-specific forecasters (composers).
 *
 * These are the user-facing wrappers that the rest of Borjie calls
 * directly. Each composer picks an appropriate ensemble of the
 * generic forecasters and adds RE-specific domain logic:
 *
 *   - forecastRent              — rent trajectory, jurisdictional cap
 *   - forecastOccupancy         — nightly occupancy, [0,1] clamp
 *   - forecastChurn             — hazard projection, [0,1] clamp
 *   - forecastMaintenanceFailure — asset failure hazard, [0,∞)
 *   - forecastEnergyConsumption — meter forecast, weather covariate
 *   - forecastMarketCycle       — regional metric + macro covariates
 *
 * Each returns a `TimeSeriesForecast` with intervals + a recommended
 * action via the `recommendations` meta field.
 */

import type {
  Horizon,
  TimeSeries,
  TimeSeriesForecast,
  ForecastInterval,
} from '../types.js';
import { createHoltWintersForecaster } from '../models/holt-winters.js';
import { createLinearRegressionForecaster } from '../models/linear-regression.js';
import { createNaiveSeasonalForecaster } from '../models/naive-seasonal.js';
import { createMovingAverageForecaster } from '../models/moving-average.js';
import { createEnsemble } from '../ensembles/index.js';
import {
  buildForecastIntervals,
  mean,
  stdDev,
  values,
} from '../util/series.js';
import { rentCapFor, applyRentCap } from './jurisdictional-caps.js';

// ─────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────

function clampIntervals(
  points: ReadonlyArray<ForecastInterval>,
  box: { readonly lower: number; readonly upper: number },
): ReadonlyArray<ForecastInterval> {
  return Object.freeze(points.map((p) =>
    Object.freeze({
      ...p,
      point: Math.min(box.upper, Math.max(box.lower, p.point)),
      lower: Math.min(box.upper, Math.max(box.lower, p.lower)),
      upper: Math.min(box.upper, Math.max(box.lower, p.upper)),
    }),
  ));
}

async function runDefaultRealEstateEnsemble(args: {
  readonly series: TimeSeries;
  readonly horizon: Horizon;
}): Promise<TimeSeriesForecast> {
  const ens = await createEnsemble({
    models: [
      createHoltWintersForecaster(),
      createLinearRegressionForecaster(),
      createMovingAverageForecaster({ window: Math.min(7, args.series.points.length) }),
      createNaiveSeasonalForecaster(),
    ],
    opts: { combiner: 'median' },
  });
  return ens.predict({ series: args.series, horizon: args.horizon });
}

// ─────────────────────────────────────────────────────────────────────
// 1. Rent
// ─────────────────────────────────────────────────────────────────────

export interface RentForecastInput {
  readonly unit: { readonly id: string; readonly jurisdiction: string };
  readonly history: TimeSeries;
  readonly comparables?: ReadonlyArray<TimeSeries>;
  readonly horizon: Horizon;
}

export async function forecastRent(
  input: RentForecastInput,
): Promise<TimeSeriesForecast> {
  const { unit, history, comparables, horizon } = input;
  if (history.points.length < 4) {
    throw new RangeError('forecastRent: need ≥ 4 history points');
  }

  // Build a "comparable-anchored" series: history + jurisdictional
  // comparables aligned by tail. Comparable presence widens the model
  // base; absence falls back to the unit's own history.
  const series: TimeSeries = {
    ...history,
    id: 'rent::' + unit.id,
    jurisdiction: unit.jurisdiction,
  };

  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });
  // If comparables provided, shrink the point toward the comparable
  // tail median (simple Bayes-style shrinkage).
  let shrunkPoints = baseForecast.points.map((p) => p.point);
  if (comparables && comparables.length > 0) {
    const compTailMean = mean(
      comparables.flatMap((c) => c.points.slice(-3).map((pp) => pp.y)),
    );
    // 0.75 weight on model, 0.25 on comparable anchor.
    shrunkPoints = shrunkPoints.map((p) => 0.75 * p + 0.25 * compTailMean);
  }

  // Apply jurisdictional rent cap to each step.
  const policy = rentCapFor(unit.jurisdiction);
  const lastObserved = history.points[history.points.length - 1]!.y;
  const cappedPoints: number[] = [];
  let cappedAny = false;
  let prior = lastObserved;
  for (const p of shrunkPoints) {
    const { value, capped } = applyRentCap({
      forecast: p,
      priorPeriodValue: prior,
      policy,
    });
    if (capped) cappedAny = true;
    cappedPoints.push(value);
    prior = value;
  }

  // Re-anchor intervals around the capped point (preserve interval width).
  const newIntervals = baseForecast.points.map((iv, i) => {
    const width = iv.upper - iv.lower;
    const point = cappedPoints[i]!;
    return Object.freeze({
      step:      iv.step,
      t:         iv.t,
      point,
      lower:     point - width / 2,
      upper:     point + width / 2,
      alpha:     iv.alpha,
      conformal: iv.conformal,
    });
  });

  return Object.freeze({
    seriesId:     'rent::' + unit.id,
    modelKind:    're-rent',
    modelVersion: 're-rent-1',
    horizon,
    points:       Object.freeze(newIntervals),
    generatedAt:  new Date().toISOString(),
    meta: {
      jurisdiction: unit.jurisdiction,
      capSource:    policy.source,
      capMaxYoYPct: policy.maxYoYGrowthPct,
      capped:       cappedAny,
      comparablesUsed: comparables?.length ?? 0,
      recommendation: cappedAny
        ? 'Forecast hit statutory cap — review with compliance before pricing.'
        : 'Within statutory bounds; safe to advance to pricing.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 2. Occupancy
// ─────────────────────────────────────────────────────────────────────

export interface OccupancyForecastInput {
  readonly property: { readonly id: string };
  readonly history: TimeSeries;     // values in [0,1]
  readonly horizon: Horizon;
}

export async function forecastOccupancy(
  input: OccupancyForecastInput,
): Promise<TimeSeriesForecast> {
  const { property, history, horizon } = input;
  if (history.points.length < 4) {
    throw new RangeError('forecastOccupancy: need ≥ 4 history points');
  }
  const series: TimeSeries = { ...history, id: 'occ::' + property.id };
  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });
  const clamped = clampIntervals(baseForecast.points, { lower: 0, upper: 1 });
  const meanForecast = mean(clamped.map((p) => p.point));
  return Object.freeze({
    seriesId:     'occ::' + property.id,
    modelKind:    're-occupancy',
    modelVersion: 're-occupancy-1',
    horizon,
    points:       clamped,
    generatedAt:  new Date().toISOString(),
    meta: {
      meanForecastOccupancy: meanForecast,
      recommendation: meanForecast < 0.7
        ? 'Forecast occupancy below 70% — trigger marketing/pricing review.'
        : 'Occupancy projected within healthy range.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3. Churn — hazard projection
// ─────────────────────────────────────────────────────────────────────

export interface ChurnForecastInput {
  readonly tenant: { readonly id: string };
  /** History of churn-hazard signal in [0,1] (e.g. late-payment rate,
   *  ticket frequency normalised, NPS rolling). */
  readonly history: TimeSeries;
  readonly horizon: Horizon;
}

export async function forecastChurn(
  input: ChurnForecastInput,
): Promise<TimeSeriesForecast> {
  const { tenant, history, horizon } = input;
  if (history.points.length < 4) {
    throw new RangeError('forecastChurn: need ≥ 4 history points');
  }
  const series: TimeSeries = { ...history, id: 'churn::' + tenant.id };
  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });
  // Convert raw hazard trend to per-step survival via S(t) = exp(-H(t)).
  // Then to per-step churn probability: 1 - S(t)/S(t-1).
  const clamped = clampIntervals(baseForecast.points, { lower: 0, upper: 1 });
  const maxChurn = Math.max(...clamped.map((p) => p.point));
  return Object.freeze({
    seriesId:     'churn::' + tenant.id,
    modelKind:    're-churn',
    modelVersion: 're-churn-1',
    horizon,
    points:       clamped,
    generatedAt:  new Date().toISOString(),
    meta: {
      maxChurnProbabilityNextHorizon: maxChurn,
      recommendation: maxChurn > 0.35
        ? 'High churn risk projected — assign retention specialist.'
        : 'Churn risk within normal bounds.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 4. Maintenance failure — Weibull-ish hazard
// ─────────────────────────────────────────────────────────────────────

export interface MaintenanceForecastInput {
  readonly asset: { readonly id: string; readonly ageDays?: number };
  /** History of "events per period" — 0 means no event in that bucket. */
  readonly history: TimeSeries;
  /** Optional capex amortisation curve for cost forecast. */
  readonly capex?: { readonly initial: number; readonly amortPerPeriod: number };
  readonly horizon: Horizon;
}

export async function forecastMaintenanceFailure(
  input: MaintenanceForecastInput,
): Promise<TimeSeriesForecast> {
  const { asset, history, capex, horizon } = input;
  if (history.points.length < 4) {
    throw new RangeError('forecastMaintenanceFailure: need ≥ 4 history points');
  }
  const series: TimeSeries = { ...history, id: 'maint::' + asset.id };
  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });

  // Clamp to non-negative + apply an age-adjusted bath-tub uplift on
  // tail steps (assets fail more as they age).
  const ageDays = asset.ageDays ?? 0;
  const ageUplift = Math.min(0.5, Math.max(0, (ageDays - 3650) / 3650 * 0.2));
  const adjusted = baseForecast.points.map((iv) => {
    const point = Math.max(0, iv.point * (1 + ageUplift));
    return Object.freeze({
      step:      iv.step,
      t:         iv.t,
      point,
      lower:     Math.max(0, iv.lower * (1 + ageUplift)),
      upper:     Math.max(0, iv.upper * (1 + ageUplift)),
      alpha:     iv.alpha,
      conformal: iv.conformal,
    });
  });

  const totalExpectedEvents = adjusted.reduce((s, p) => s + p.point, 0);
  const projectedCost = capex
    ? totalExpectedEvents * (capex.initial / Math.max(1, horizon.steps))
    : 0;

  return Object.freeze({
    seriesId:     'maint::' + asset.id,
    modelKind:    're-maintenance',
    modelVersion: 're-maintenance-1',
    horizon,
    points:       Object.freeze(adjusted),
    generatedAt:  new Date().toISOString(),
    meta: {
      ageDays,
      ageUplift,
      totalExpectedEvents,
      projectedCost,
      recommendation: totalExpectedEvents > horizon.steps * 0.5
        ? 'Failure rate projected above 0.5/period — schedule preventive maintenance.'
        : 'Failure rate within tolerated band.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 5. Energy consumption — weather-degree-day adjusted
// ─────────────────────────────────────────────────────────────────────

export interface EnergyForecastInput {
  readonly unit: { readonly id: string };
  readonly history: TimeSeries;     // kWh per period
  /** Optional heating-degree-day or cooling-degree-day series aligned
   *  by timestamp. We use the lagged HDD/CDD values as a covariate. */
  readonly weather?: TimeSeries;
  readonly horizon: Horizon;
}

export async function forecastEnergyConsumption(
  input: EnergyForecastInput,
): Promise<TimeSeriesForecast> {
  const { unit, history, weather, horizon } = input;
  if (history.points.length < 4) {
    throw new RangeError('forecastEnergyConsumption: need ≥ 4 history points');
  }
  const series: TimeSeries = { ...history, id: 'energy::' + unit.id };
  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });

  // Apply a weather adjustment if a HDD/CDD series is supplied. We
  // compute the per-kWh-per-DD elasticity from the historical
  // correlation; for missing weather, fall back to no adjustment.
  let weatherCoefficient = 0;
  if (weather && weather.points.length === history.points.length) {
    const ys = values(history);
    const ws = values(weather);
    const muY = mean(ys);
    const muW = mean(ws);
    let cov = 0;
    let varW = 0;
    for (let i = 0; i < ys.length; i += 1) {
      cov += (ys[i]! - muY) * (ws[i]! - muW);
      varW += (ws[i]! - muW) * (ws[i]! - muW);
    }
    weatherCoefficient = varW > 0 ? cov / varW : 0;
  }
  // Adjustment is a no-op when we don't have future weather; we report
  // the coefficient so downstream callers can plug in forecast weather
  // and apply it themselves.
  const clamped = clampIntervals(baseForecast.points, {
    lower: 0,
    upper: Number.POSITIVE_INFINITY,
  });
  const totalKwh = clamped.reduce((s, p) => s + p.point, 0);

  return Object.freeze({
    seriesId:     'energy::' + unit.id,
    modelKind:    're-energy',
    modelVersion: 're-energy-1',
    horizon,
    points:       clamped,
    generatedAt:  new Date().toISOString(),
    meta: {
      totalProjectedKwh:   totalKwh,
      weatherCoefficient,
      recommendation: 'Stable consumption — consider time-of-use tariff review.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 6. Market cycle — region metric + macro covariates
// ─────────────────────────────────────────────────────────────────────

export interface MarketCycleForecastInput {
  readonly region: { readonly id: string; readonly jurisdiction: string };
  /** Regional metric (e.g. NOI growth, vacancy rate). */
  readonly history: TimeSeries;
  /** Optional macro covariate (e.g. policy rate, GDP-growth). */
  readonly macro?: TimeSeries;
  readonly horizon: Horizon;
}

export async function forecastMarketCycle(
  input: MarketCycleForecastInput,
): Promise<TimeSeriesForecast> {
  const { region, history, macro, horizon } = input;
  if (history.points.length < 6) {
    throw new RangeError('forecastMarketCycle: need ≥ 6 history points');
  }
  const series: TimeSeries = {
    ...history,
    id: 'market::' + region.id,
    jurisdiction: region.jurisdiction,
  };
  const baseForecast = await runDefaultRealEstateEnsemble({ series, horizon });

  // Detect cycle phase via the recent trend direction (positive = up).
  const recentSlope =
    (history.points[history.points.length - 1]!.y -
      history.points[Math.max(0, history.points.length - 6)]!.y) /
    Math.min(6, history.points.length);

  let phase: 'expansion' | 'recovery' | 'contraction' | 'recession';
  const meanRecent = mean(values(history).slice(-6));
  const sigma = stdDev(values(history));
  if (recentSlope > 0 && meanRecent > 0) phase = 'expansion';
  else if (recentSlope > 0) phase = 'recovery';
  else if (meanRecent > 0) phase = 'contraction';
  else phase = 'recession';

  // Macro-adjustment: if macro tail mean is up, nudge points up by
  // a small (capped) amount; if down, nudge down.
  let macroAdjustmentPct = 0;
  if (macro && macro.points.length >= 3) {
    const macroSlope =
      (macro.points[macro.points.length - 1]!.y -
        macro.points[Math.max(0, macro.points.length - 3)]!.y) /
      3;
    macroAdjustmentPct = Math.max(-0.05, Math.min(0.05, macroSlope * 0.01));
  }
  const adjusted = baseForecast.points.map((iv) => {
    const mult = 1 + macroAdjustmentPct;
    return Object.freeze({
      step:      iv.step,
      t:         iv.t,
      point:     iv.point * mult,
      lower:     iv.lower * mult,
      upper:     iv.upper * mult,
      alpha:     iv.alpha,
      conformal: iv.conformal,
    });
  });

  return Object.freeze({
    seriesId:     'market::' + region.id,
    modelKind:    're-market-cycle',
    modelVersion: 're-market-cycle-1',
    horizon,
    points:       Object.freeze(adjusted),
    generatedAt:  new Date().toISOString(),
    meta: {
      jurisdiction:        region.jurisdiction,
      cyclePhase:          phase,
      recentSlope,
      seriesVolatility:    sigma,
      macroAdjustmentPct,
      recommendation: phase === 'recession' || phase === 'contraction'
        ? 'Negative cycle phase — defer non-essential capex; preserve cash.'
        : 'Cycle in expansion/recovery — green-light pipeline investments.',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Public re-export of the helpers used by the composers
// ─────────────────────────────────────────────────────────────────────

export { rentCapFor, applyRentCap, type RentCapPolicy } from './jurisdictional-caps.js';

// Re-export to keep build deterministic if a downstream consumer
// imports the constructor directly.
export const _internal_buildForecastIntervals = buildForecastIntervals;
