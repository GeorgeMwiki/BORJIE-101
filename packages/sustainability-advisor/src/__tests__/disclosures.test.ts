/**
 * Disclosure renderer tests — TCFD narrative, IFRS S2 pack,
 * GRESB input builder.
 */

import { describe, it, expect } from 'vitest';
import { renderTcfdNarrative } from '../disclosures/tcfd-renderer.js';
import { renderIfrsS2Pack } from '../disclosures/ifrs-s2-renderer.js';
import { buildGresbInputPack, gresbRowFromCarbon } from '../disclosures/gresb-input-builder.js';
import { computeScope1 } from '../ghg-scope/scope1-calc.js';
import { computeScope2 } from '../ghg-scope/scope2-calc.js';
import { computeScope3 } from '../ghg-scope/scope3-calc.js';
import { rollupCarbon } from '../advisor/property-esg-report.js';
import type { CarbonReport, ReportingPeriod } from '../types.js';

const PERIOD: ReportingPeriod = {
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  financialYear: 'FY26',
};

function makeCarbon(opts: { electricityKWh: number; gasKWh: number; country: string }): CarbonReport {
  const s1 = computeScope1({
    fuels: [{ fuel: 'natural_gas_kwh', quantity: opts.gasKWh }],
    refrigerants: [],
  });
  const s2 = computeScope2({
    country: opts.country,
    electricityKWh: opts.electricityKWh,
  });
  const s3 = computeScope3({
    waste: [{ stream: 'mixed_recycling', tonnes: 2 }],
  });
  return rollupCarbon({
    propertyId: 'p1',
    period: PERIOD,
    grossInternalArea_m2: 1000,
    scope1: s1,
    scope2: s2,
    scope3: s3,
    embodied: null,
  });
}

describe('TCFD narrative', () => {
  it('produces 4-pillar narrative with totals', () => {
    const carbon = makeCarbon({ electricityKWh: 100_000, gasKWh: 50_000, country: 'GB' });
    const n = renderTcfdNarrative({
      entityName: 'Borjie REIT',
      carbon,
      hasBoardOversight: true,
      hasManagementCommittee: true,
      scenarios: ['IEA NZE 2050', 'IEA STEPS'],
      hasTransitionPlan: true,
      internalCarbonPricePerTonne: 95,
      physicalRisksMaterial: ['flooding (50y)', 'overheating'],
      transitionRisksMaterial: ['EU CBAM concrete'],
      targetsKgCO2ePerM2: 10,
      targetYear: 2030,
    });
    expect(n.governance).toContain('Board-level oversight');
    expect(n.strategy).toContain('IEA NZE 2050');
    expect(n.metricsAndTargets).toContain('FY26');
    expect(n.riskManagement).toContain('enterprise risk');
  });

  it('flags gaps when governance is missing', () => {
    const carbon = makeCarbon({ electricityKWh: 50_000, gasKWh: 10_000, country: 'KE' });
    const n = renderTcfdNarrative({
      entityName: 'Acme PM',
      carbon,
      hasBoardOversight: false,
      hasManagementCommittee: false,
      scenarios: [],
      hasTransitionPlan: false,
      internalCarbonPricePerTonne: null,
      physicalRisksMaterial: [],
      transitionRisksMaterial: [],
      targetsKgCO2ePerM2: null,
      targetYear: null,
    });
    expect(n.governance).toContain('NOT in place');
    expect(n.strategy).toContain('NOT published');
    expect(n.metricsAndTargets).toContain('No quantified intensity target');
  });
});

describe('IFRS S2 pack', () => {
  it('packs cross-industry + real-estate metrics', () => {
    const carbon = makeCarbon({ electricityKWh: 100_000, gasKWh: 50_000, country: 'GB' });
    const pack = renderIfrsS2Pack({
      entityName: 'Borjie REIT',
      period: PERIOD,
      carbon,
      governance: 'Board oversees climate quarterly.',
      strategy: '1.5C-aligned transition plan published.',
      riskManagement: 'Integrated into ERM with quarterly review.',
      transitionRiskExposure: 'Stranded asset risk on legacy gas heating.',
      physicalRiskExposure: 'Coastal flooding on 12% of GIA.',
      climateCapexPct: 18,
      internalCarbonPricePerTonne: 95,
      assetClassMix: { office: 60, residential: 40 },
      siteEnergyMWh: 150,
      gridElectricityPct: 100,
      renewableElectricityPct: 35,
      likeForLikeScope1Plus2KgCO2e: 35_000,
      waterWithdrawalM3: 1_200,
      certifiedGfaPct: 45,
      targets: [
        {
          metric: 'kgCO2e/m²',
          target: 10,
          unit: 'kgCO2e/m²/yr',
          baselineYear: 2024,
          targetYear: 2030,
          progress: 0.45,
        },
      ],
    });
    expect(pack.crossIndustryMetrics.scope1KgCO2e).toBe(carbon.scope1.totalKgCO2e);
    expect(pack.crossIndustryMetrics.scope2MarketKgCO2e).toBe(carbon.scope2.totalKgCO2eMarketBased);
    expect(pack.industryMetricsRealEstate.renewableElectricityPct).toBe(35);
  });

  it('rejects target progress out of [0,1]', () => {
    const carbon = makeCarbon({ electricityKWh: 1_000, gasKWh: 1_000, country: 'GB' });
    expect(() => renderIfrsS2Pack({
      entityName: 'X', period: PERIOD, carbon,
      governance: '', strategy: '', riskManagement: '',
      transitionRiskExposure: '', physicalRiskExposure: '',
      climateCapexPct: 5, internalCarbonPricePerTonne: null,
      assetClassMix: { office: 100 },
      siteEnergyMWh: 10, gridElectricityPct: 100, renewableElectricityPct: 0,
      likeForLikeScope1Plus2KgCO2e: 100, waterWithdrawalM3: 10, certifiedGfaPct: 0,
      targets: [{ metric: 'x', target: 1, unit: 'u', baselineYear: 2020, targetYear: 2030, progress: 1.5 }],
    })).toThrow(/progress/);
  });

  it('rejects out-of-range climate capex pct', () => {
    const carbon = makeCarbon({ electricityKWh: 1_000, gasKWh: 1_000, country: 'GB' });
    expect(() => renderIfrsS2Pack({
      entityName: 'X', period: PERIOD, carbon,
      governance: '', strategy: '', riskManagement: '',
      transitionRiskExposure: '', physicalRiskExposure: '',
      climateCapexPct: 150, internalCarbonPricePerTonne: null,
      assetClassMix: { office: 100 },
      siteEnergyMWh: 10, gridElectricityPct: 100, renewableElectricityPct: 0,
      likeForLikeScope1Plus2KgCO2e: 100, waterWithdrawalM3: 10, certifiedGfaPct: 0,
      targets: [],
    })).toThrow(/climateCapexPct/);
  });
});

describe('GRESB input builder', () => {
  it('packages a single-asset class with prior-year comparison', () => {
    const pack = buildGresbInputPack({
      assessmentYear: 2026,
      entity: 'Borjie Fund I',
      managementScores: {
        leadership: 0.8,
        policies: 0.9,
        reporting: 0.85,
        riskManagement: 0.75,
        stakeholderEngagement: 0.7,
      },
      performance: [
        {
          assetClass: 'office',
          energyMWh: 150,
          ghgKgCO2e: 35_000,
          waterM3: 1_200,
          wasteTonnes: 12,
          priorYearEnergyMWh: 170,
          priorYearGhgKgCO2e: 38_000,
          bmsCoveragePct: 70,
          certifiedGfaPct: 45,
        },
      ],
    });
    expect(pack.assessmentYear).toBe(2026);
    expect(pack.performanceByAssetClass.office).toBeDefined();
    expect(pack.performanceByAssetClass.office!.ghgKgCO2e).toBe(35_000);
  });

  it('rejects bad management score', () => {
    expect(() => buildGresbInputPack({
      assessmentYear: 2026, entity: 'X',
      managementScores: {
        leadership: 1.5, policies: 0.5, reporting: 0.5,
        riskManagement: 0.5, stakeholderEngagement: 0.5,
      },
      performance: [],
    })).toThrow(/leadership/);
  });

  it('rejects bad assessment year', () => {
    expect(() => buildGresbInputPack({
      assessmentYear: 2010, entity: 'X',
      managementScores: { leadership: 0.5, policies: 0.5, reporting: 0.5, riskManagement: 0.5, stakeholderEngagement: 0.5 },
      performance: [],
    })).toThrow(/assessmentYear/);
  });

  it('gresbRowFromCarbon copies emissions onto the row', () => {
    const cy = makeCarbon({ electricityKWh: 100_000, gasKWh: 50_000, country: 'GB' });
    const py = makeCarbon({ electricityKWh: 110_000, gasKWh: 55_000, country: 'GB' });
    const row = gresbRowFromCarbon({
      assetClass: 'office',
      current: cy,
      priorYear: py,
      energyMWh: 150,
      priorYearEnergyMWh: 165,
      waterM3: 1_000,
      wasteTonnes: 10,
      bmsCoveragePct: 90,
      certifiedGfaPct: 30,
    });
    expect(row.ghgKgCO2e).toBe(cy.totalOperationalKgCO2e);
    expect(row.priorYearGhgKgCO2e).toBe(py.totalOperationalKgCO2e);
  });
});
