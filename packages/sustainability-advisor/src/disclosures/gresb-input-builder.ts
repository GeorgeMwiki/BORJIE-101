/**
 * GRESB Real Estate Assessment input builder.
 *
 * Output shape mirrors the GRESB Real Estate Assessment 2026 portal
 * import schema (CSV/XLSX). The package does not submit — it builds
 * the validated input pack so a GRESB representative can audit + upload.
 */

import type { AssetClass, CarbonReport, GresbInputPack, KgCO2e } from '../types.js';

export interface AssetClassPerformanceInput {
  readonly assetClass: AssetClass;
  readonly energyMWh: number;
  readonly ghgKgCO2e: KgCO2e;
  readonly waterM3: number;
  readonly wasteTonnes: number;
  readonly priorYearEnergyMWh: number;
  readonly priorYearGhgKgCO2e: KgCO2e;
  readonly bmsCoveragePct: number;
  readonly certifiedGfaPct: number;
}

export interface GresbInputs {
  readonly assessmentYear: number;
  readonly entity: string;
  readonly managementScores: Readonly<{
    readonly leadership: number;
    readonly policies: number;
    readonly reporting: number;
    readonly riskManagement: number;
    readonly stakeholderEngagement: number;
  }>;
  readonly performance: ReadonlyArray<AssetClassPerformanceInput>;
}

export function buildGresbInputPack(inputs: GresbInputs): GresbInputPack {
  validate(inputs);

  const performanceByAssetClass = inputs.performance.reduce(
    (acc, p) => {
      acc[p.assetClass] = {
        energyMWh: p.energyMWh,
        ghgKgCO2e: p.ghgKgCO2e,
        waterM3: p.waterM3,
        wasteTonnes: p.wasteTonnes,
        priorYearEnergyMWh: p.priorYearEnergyMWh,
        priorYearGhgKgCO2e: p.priorYearGhgKgCO2e,
        bmsCoveragePct: p.bmsCoveragePct,
        certifiedGfaPct: p.certifiedGfaPct,
      };
      return acc;
    },
    {} as Record<AssetClass, GresbInputPack['performanceByAssetClass'][AssetClass]>,
  );

  return {
    assessmentYear: inputs.assessmentYear,
    entity: inputs.entity,
    management: inputs.managementScores,
    performanceByAssetClass,
  };
}

/**
 * Convenience: derive a single-asset GresbInputs row directly from
 * a CarbonReport + prior-year carbon report. Useful when the rollup
 * spans a portfolio that's still single-class.
 */
export function gresbRowFromCarbon(args: {
  readonly assetClass: AssetClass;
  readonly current: CarbonReport;
  readonly priorYear: CarbonReport;
  readonly energyMWh: number;
  readonly priorYearEnergyMWh: number;
  readonly waterM3: number;
  readonly wasteTonnes: number;
  readonly bmsCoveragePct: number;
  readonly certifiedGfaPct: number;
}): AssetClassPerformanceInput {
  return {
    assetClass: args.assetClass,
    energyMWh: args.energyMWh,
    ghgKgCO2e: args.current.totalOperationalKgCO2e,
    waterM3: args.waterM3,
    wasteTonnes: args.wasteTonnes,
    priorYearEnergyMWh: args.priorYearEnergyMWh,
    priorYearGhgKgCO2e: args.priorYear.totalOperationalKgCO2e,
    bmsCoveragePct: args.bmsCoveragePct,
    certifiedGfaPct: args.certifiedGfaPct,
  };
}

function validate(inputs: GresbInputs): void {
  if (!Number.isInteger(inputs.assessmentYear) || inputs.assessmentYear < 2020) {
    throw new RangeError('gresb: assessmentYear must be ≥2020 integer');
  }
  const s = inputs.managementScores;
  for (const [k, v] of Object.entries(s)) {
    if (v < 0 || v > 1) {
      throw new RangeError(`gresb: management score ${k} must be in [0,1]`);
    }
  }
  for (const p of inputs.performance) {
    if (p.energyMWh < 0 || p.ghgKgCO2e < 0 || p.waterM3 < 0 || p.wasteTonnes < 0) {
      throw new RangeError('gresb: negative performance metric');
    }
    if (p.bmsCoveragePct < 0 || p.bmsCoveragePct > 100) {
      throw new RangeError(`gresb: bmsCoveragePct out of range for ${p.assetClass}`);
    }
    if (p.certifiedGfaPct < 0 || p.certifiedGfaPct > 100) {
      throw new RangeError(`gresb: certifiedGfaPct out of range for ${p.assetClass}`);
    }
  }
}
