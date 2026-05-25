/**
 * IFRS S2 (June 2023) — Climate-related Disclosures pack renderer.
 *
 * S2 is mandatory in the EU (via ESRS E1 / CSRD) and UK (via the
 * forthcoming Sustainability Disclosure Standards SDS-1 + SDS-2)
 * from FY26 reporting (1 Jan 2026 onwards). Reasonable assurance
 * required for large entities from FY27 onwards.
 *
 * Real-estate SASB metrics layered on top:
 *   - IF-RE-130 site energy by sub-sector
 *   - IF-RE-410 building energy management
 *   - IF-RE-450 climate-change adaptation
 */

import type {
  AssetClass,
  CarbonReport,
  IfrsS2DisclosurePack,
  KgCO2e,
  ReportingPeriod,
} from '../types.js';

export interface IfrsS2Inputs {
  readonly entityName: string;
  readonly period: ReportingPeriod;
  readonly carbon: CarbonReport;
  readonly governance: string;
  readonly strategy: string;
  readonly riskManagement: string;
  readonly transitionRiskExposure: string;
  readonly physicalRiskExposure: string;
  readonly climateCapexPct: number;
  readonly internalCarbonPricePerTonne: number | null;
  readonly assetClassMix: Readonly<Partial<Record<AssetClass, number>>>; // pct of GIA
  readonly siteEnergyMWh: number;
  readonly gridElectricityPct: number;
  readonly renewableElectricityPct: number;
  readonly likeForLikeScope1Plus2KgCO2e: KgCO2e;
  readonly waterWithdrawalM3: number;
  readonly certifiedGfaPct: number;
  readonly targets: ReadonlyArray<{
    readonly metric: string;
    readonly target: number;
    readonly unit: string;
    readonly baselineYear: number;
    readonly targetYear: number;
    readonly progress: number;
  }>;
}

export function renderIfrsS2Pack(i: IfrsS2Inputs): IfrsS2DisclosurePack {
  if (i.climateCapexPct < 0 || i.climateCapexPct > 100) {
    throw new RangeError('ifrs-s2: climateCapexPct must be in [0,100]');
  }
  if (i.gridElectricityPct < 0 || i.gridElectricityPct > 100) {
    throw new RangeError('ifrs-s2: gridElectricityPct must be in [0,100]');
  }
  if (i.renewableElectricityPct < 0 || i.renewableElectricityPct > 100) {
    throw new RangeError('ifrs-s2: renewableElectricityPct must be in [0,100]');
  }
  if (i.certifiedGfaPct < 0 || i.certifiedGfaPct > 100) {
    throw new RangeError('ifrs-s2: certifiedGfaPct must be in [0,100]');
  }

  for (const t of i.targets) {
    if (t.progress < 0 || t.progress > 1) {
      throw new RangeError(`ifrs-s2: target ${t.metric} progress must be in [0,1]`);
    }
  }

  const scope3Total = i.carbon.scope3?.totalKgCO2e ?? 0;

  return {
    entity: i.entityName,
    period: i.period,
    governance: i.governance,
    strategy: i.strategy,
    riskManagement: i.riskManagement,
    crossIndustryMetrics: {
      scope1KgCO2e: i.carbon.scope1.totalKgCO2e,
      scope2LocationKgCO2e: i.carbon.scope2.totalKgCO2eLocationBased,
      scope2MarketKgCO2e: i.carbon.scope2.totalKgCO2eMarketBased,
      scope3KgCO2e: scope3Total,
      transitionRiskExposure: i.transitionRiskExposure,
      physicalRiskExposure: i.physicalRiskExposure,
      climateCapexPct: i.climateCapexPct,
      internalCarbonPricePerTonne: i.internalCarbonPricePerTonne,
    },
    industryMetricsRealEstate: {
      siteEnergyMWh: i.siteEnergyMWh,
      gridElectricityPct: i.gridElectricityPct,
      renewableElectricityPct: i.renewableElectricityPct,
      likeForLikeScope1Plus2KgCO2e: i.likeForLikeScope1Plus2KgCO2e,
      waterWithdrawalM3: i.waterWithdrawalM3,
      certifiedGfaPct: i.certifiedGfaPct,
    },
    targets: i.targets,
  };
}
