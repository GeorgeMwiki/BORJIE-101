/**
 * Forecasting scenarios — synthetic property-management series shaped
 * like the real Borjie signals we care about. Every series is
 * fully reproducible from a seed; nothing here calls the wall clock or
 * Math.random.
 *
 * Three scenarios:
 *
 *   rent_forecast    — monthly rent at the unit level. Linear escalator,
 *                      occasional step-jumps at lease renewals, monthly
 *                      seasonality (Jan/Dec collection dips), heavy-
 *                      tailed shocks. Horizon = next 3 months.
 *
 *   vacancy_forecast — 7-day vacancy count from arrivals/departures.
 *                      Strong weekly seasonality (move-ins cluster on
 *                      weekends), AR(1) carry-over, occasional spikes.
 *
 *   churn_forecast   — quarterly churn rate per cohort, bounded in
 *                      [0,1]. Beta-distributed noise around a slow-
 *                      drifting mean with policy-shock jumps.
 *
 * Each scenario produces:
 *   - `series`: ReadonlyArray<SeriesInput> ready for `runBacktest`
 *   - `config`: a sensible default BacktestConfig for the scenario
 *   - `seasonality`: the m used everywhere downstream
 */

import type { SeriesInput, BacktestConfig } from './backtest.ts';

export interface Scenario {
  readonly id: 'rent_forecast' | 'vacancy_forecast' | 'churn_forecast';
  readonly description: string;
  readonly series: ReadonlyArray<SeriesInput>;
  readonly config: BacktestConfig;
  readonly seasonality: number;
}

// ───────────────────────────────────────────────────────────────────────
// Deterministic PRNG — mulberry32, independent of baselines.ts copy so
// scenarios + baselines have separate seed lineages.
// ───────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Beta(a,b) via two gamma draws using Marsaglia & Tsang's method (a,b >= 1). */
function gammaMT(rng: () => number, shape: number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // bounded loop — guaranteed to converge in O(1) expected iterations
  for (let i = 0; i < 1000; i += 1) {
    const x = randn(rng);
    const v = (1 + c * x) ** 3;
    if (v > 0) {
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v;
      }
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }
  // Extremely unlikely fallback; mean of the Gamma distribution.
  return d;
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gammaMT(rng, Math.max(a, 1));
  const y = gammaMT(rng, Math.max(b, 1));
  return x / (x + y);
}

// ───────────────────────────────────────────────────────────────────────
// Scenario builders.
// ───────────────────────────────────────────────────────────────────────

interface RentParams {
  readonly tenantCount: number;
  readonly unitsPerTenant: number;
  readonly months: number;
  readonly seed: number;
}

export function buildRentForecastScenario(params: Partial<RentParams> = {}): Scenario {
  const tenantCount = params.tenantCount ?? 10;
  const unitsPerTenant = params.unitsPerTenant ?? 10;
  const months = params.months ?? 60;
  const seed = params.seed ?? 42;
  const series: Array<SeriesInput> = [];
  for (let t = 0; t < tenantCount; t += 1) {
    const tenantId = `tenant_${String(t + 1).padStart(3, '0')}`;
    for (let u = 0; u < unitsPerTenant; u += 1) {
      const seriesId = `${tenantId}_unit_${String(u + 1).padStart(3, '0')}`;
      const rng = mulberry32(seed + t * 997 + u);
      const baseRent = 800 + rng() * 1200;            // 800..2000 minor-units
      const escalator = 0.002 + rng() * 0.003;        // ~0.2..0.5 percent / month
      const values: Array<number> = [];
      let cumulativeStep = 0;
      for (let i = 0; i < months; i += 1) {
        // Annual seasonality with December dip + March-renewal bump.
        const monthOfYear = i % 12;
        const seasonal = -25 * Math.cos(2 * Math.PI * (monthOfYear / 12))
          + (monthOfYear === 11 ? -40 : 0)
          + (monthOfYear === 2 ? 30 : 0);
        // Renewal step: every 12 months, ~70 percent chance of a rent bump.
        if (i > 0 && i % 12 === 0 && rng() < 0.7) {
          cumulativeStep += baseRent * (0.02 + rng() * 0.05);
        }
        const trend = baseRent * escalator * i;
        const noise = randn(rng) * baseRent * 0.015;
        // Heavy-tailed shock ~5 percent of months.
        const shock = rng() < 0.05 ? randn(rng) * baseRent * 0.08 : 0;
        values.push(baseRent + trend + cumulativeStep + seasonal + noise + shock);
      }
      series.push({ seriesId, tenantId, values, seasonality: 12 });
    }
  }
  return {
    id: 'rent_forecast',
    description: `Monthly rent forecasts across ${series.length} units (${tenantCount} tenants, ${months} months).`,
    series,
    config: {
      strategy: 'expanding',
      horizon: 3,
      minTrainSize: 24,
      stride: 3,
      maxFolds: 10,
    },
    seasonality: 12,
  };
}

interface VacancyParams {
  readonly tenantCount: number;
  readonly propertiesPerTenant: number;
  readonly days: number;
  readonly seed: number;
}

export function buildVacancyForecastScenario(params: Partial<VacancyParams> = {}): Scenario {
  const tenantCount = params.tenantCount ?? 8;
  const propertiesPerTenant = params.propertiesPerTenant ?? 4;
  const days = params.days ?? 365;
  const seed = params.seed ?? 4242;
  const series: Array<SeriesInput> = [];
  for (let t = 0; t < tenantCount; t += 1) {
    const tenantId = `tenant_${String(t + 1).padStart(3, '0')}`;
    for (let p = 0; p < propertiesPerTenant; p += 1) {
      const seriesId = `${tenantId}_prop_${String(p + 1).padStart(3, '0')}`;
      const rng = mulberry32(seed + t * 1009 + p);
      const baseVacancy = 4 + rng() * 8;     // 4..12 vacant rooms
      const arPhi = 0.55 + rng() * 0.25;     // AR(1) coefficient
      const values: Array<number> = [];
      let prev = baseVacancy;
      for (let i = 0; i < days; i += 1) {
        const dayOfWeek = i % 7;
        // Move-ins cluster on weekends (Sat/Sun=5/6) — vacancy drops.
        const weekly = dayOfWeek >= 5 ? -1.5 : (dayOfWeek === 0 ? -0.5 : 0.4);
        const noise = randn(rng) * 0.6;
        const spike = rng() < 0.02 ? randn(rng) * 3 : 0;
        const next = baseVacancy + arPhi * (prev - baseVacancy) + weekly + noise + spike;
        values.push(Math.max(0, next));
        prev = next;
      }
      series.push({ seriesId, tenantId, values, seasonality: 7 });
    }
  }
  return {
    id: 'vacancy_forecast',
    description: `7-day vacancy count across ${series.length} properties (${tenantCount} tenants, ${days} days).`,
    series,
    config: {
      strategy: 'sliding',
      horizon: 7,
      minTrainSize: 60,
      slidingWindow: 120,
      stride: 14,
      maxFolds: 12,
    },
    seasonality: 7,
  };
}

interface ChurnParams {
  readonly tenantCount: number;
  readonly cohortsPerTenant: number;
  readonly quarters: number;
  readonly seed: number;
}

export function buildChurnForecastScenario(params: Partial<ChurnParams> = {}): Scenario {
  const tenantCount = params.tenantCount ?? 12;
  const cohortsPerTenant = params.cohortsPerTenant ?? 3;
  const quarters = params.quarters ?? 24;
  const seed = params.seed ?? 8888;
  const series: Array<SeriesInput> = [];
  for (let t = 0; t < tenantCount; t += 1) {
    const tenantId = `tenant_${String(t + 1).padStart(3, '0')}`;
    for (let c = 0; c < cohortsPerTenant; c += 1) {
      const seriesId = `${tenantId}_cohort_${String(c + 1).padStart(3, '0')}`;
      const rng = mulberry32(seed + t * 1013 + c);
      const baseChurn = 0.05 + rng() * 0.10;     // 5..15 percent per quarter
      const drift = (rng() - 0.5) * 0.0008;       // ±0.04 percent per quarter
      const values: Array<number> = [];
      for (let i = 0; i < quarters; i += 1) {
        const mean = Math.min(0.6, Math.max(0.01, baseChurn + drift * i));
        // Beta noise — concentration controls dispersion around the mean.
        const concentration = 80 + rng() * 60;
        const a = mean * concentration;
        const b = (1 - mean) * concentration;
        let draw = beta(rng, a, b);
        // Policy shock — ~1 in 20 quarters get a step.
        if (rng() < 0.05) {
          draw = Math.min(0.6, draw * (1.5 + rng() * 1.5));
        }
        values.push(draw);
      }
      series.push({ seriesId, tenantId, values, seasonality: 4 });
    }
  }
  return {
    id: 'churn_forecast',
    description: `Quarterly cohort churn across ${series.length} cohorts (${tenantCount} tenants, ${quarters} quarters).`,
    series,
    config: {
      strategy: 'expanding',
      horizon: 1,
      minTrainSize: 10,
      stride: 1,
      maxFolds: 12,
    },
    seasonality: 4,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Scenario registry.
// ───────────────────────────────────────────────────────────────────────

export type ScenarioId = Scenario['id'];

export const SCENARIO_IDS: ReadonlyArray<ScenarioId> = [
  'rent_forecast',
  'vacancy_forecast',
  'churn_forecast',
];

export function buildScenario(id: ScenarioId): Scenario {
  switch (id) {
    case 'rent_forecast':
      return buildRentForecastScenario();
    case 'vacancy_forecast':
      return buildVacancyForecastScenario();
    case 'churn_forecast':
      return buildChurnForecastScenario();
    default: {
      const exhaustive: never = id;
      throw new Error(`unknown scenario id ${String(exhaustive)}`);
    }
  }
}
