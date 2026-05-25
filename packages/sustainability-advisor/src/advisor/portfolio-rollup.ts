/**
 * Multi-property portfolio rollup + peer benchmarking.
 *
 * Pure: takes an array of PropertyEsg reports + a per-asset-class
 * benchmark table (e.g. GRESB peer means) and returns a single
 * portfolio summary.
 */

import type {
  AssetClass,
  KgCO2e,
  PropertyEsg,
} from '../types.js';

export interface PortfolioBenchmarks {
  /** kgCO2e/m²/yr median for the asset class. */
  readonly medianIntensityKgM2: Readonly<Partial<Record<AssetClass, number>>>;
  /** kWh/m²/yr median (informational). */
  readonly medianEnergyKWhM2?: Readonly<Partial<Record<AssetClass, number>>>;
}

export interface PortfolioRollup {
  readonly propertyCount: number;
  readonly totalGIA_m2: number;
  readonly totalOperationalKgCO2e: KgCO2e;
  readonly weightedIntensityKgM2: KgCO2e;
  readonly byAssetClass: Readonly<Record<AssetClass, {
    readonly count: number;
    readonly totalGIA_m2: number;
    readonly totalKgCO2e: KgCO2e;
    readonly intensityKgM2: KgCO2e;
    readonly benchmarkIntensityKgM2: KgCO2e | null;
    /** Sign: positive = above benchmark (worse), negative = below (better). */
    readonly deltaVsBenchmarkPct: number | null;
  }>>;
  readonly worstPerformers: ReadonlyArray<{
    readonly propertyId: string;
    readonly intensityKgM2: KgCO2e;
  }>;
  readonly bestPerformers: ReadonlyArray<{
    readonly propertyId: string;
    readonly intensityKgM2: KgCO2e;
  }>;
}

export function rollupPortfolio(
  reports: ReadonlyArray<PropertyEsg>,
  benchmarks?: PortfolioBenchmarks,
): PortfolioRollup {
  if (reports.length === 0) {
    return {
      propertyCount: 0,
      totalGIA_m2: 0,
      totalOperationalKgCO2e: 0,
      weightedIntensityKgM2: 0,
      byAssetClass: {} as PortfolioRollup['byAssetClass'],
      worstPerformers: [],
      bestPerformers: [],
    };
  }

  const totalGIA = reports.reduce((acc, r) => acc + r.property.grossInternalArea_m2, 0);
  const totalKg = reports.reduce((acc, r) => acc + r.carbon.totalOperationalKgCO2e, 0);
  const weighted = totalGIA > 0 ? totalKg / totalGIA : 0;

  // Group by asset class.
  const grouped = new Map<AssetClass, PropertyEsg[]>();
  for (const r of reports) {
    const arr = grouped.get(r.property.assetClass) ?? [];
    arr.push(r);
    grouped.set(r.property.assetClass, arr);
  }

  const byClass = {} as Record<AssetClass, PortfolioRollup['byAssetClass'][AssetClass]>;
  for (const [cls, list] of grouped) {
    const gia = list.reduce((acc, r) => acc + r.property.grossInternalArea_m2, 0);
    const kg = list.reduce((acc, r) => acc + r.carbon.totalOperationalKgCO2e, 0);
    const intensity = gia > 0 ? kg / gia : 0;
    const bench = benchmarks?.medianIntensityKgM2?.[cls] ?? null;
    const delta = bench !== null && bench > 0
      ? ((intensity - bench) / bench) * 100
      : null;
    byClass[cls] = {
      count: list.length,
      totalGIA_m2: round3(gia),
      totalKgCO2e: round3(kg),
      intensityKgM2: round3(intensity),
      benchmarkIntensityKgM2: bench,
      deltaVsBenchmarkPct: delta === null ? null : round3(delta),
    };
  }

  // Rank by intensity.
  const ranked = [...reports]
    .map((r) => ({
      propertyId: r.property.propertyId,
      intensityKgM2: r.carbon.intensityKgCO2ePerM2,
    }))
    .sort((a, b) => b.intensityKgM2 - a.intensityKgM2);

  return {
    propertyCount: reports.length,
    totalGIA_m2: round3(totalGIA),
    totalOperationalKgCO2e: round3(totalKg),
    weightedIntensityKgM2: round3(weighted),
    byAssetClass: byClass,
    worstPerformers: ranked.slice(0, 5),
    bestPerformers: ranked.slice(-5).reverse(),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
