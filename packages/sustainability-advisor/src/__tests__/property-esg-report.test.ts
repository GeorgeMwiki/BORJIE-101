/**
 * Top-level advisor + portfolio rollup tests.
 *
 * Builds an end-to-end PropertyEsg report from the underlying
 * calculators and asserts the executive-summary + veteran-notes
 * tell a coherent story.
 */

import { describe, it, expect } from 'vitest';
import { computeScope1 } from '../ghg-scope/scope1-calc.js';
import { computeScope2 } from '../ghg-scope/scope2-calc.js';
import { computeScope3 } from '../ghg-scope/scope3-calc.js';
import { computeEmbodiedCarbon } from '../ghg-scope/embodied-carbon-calc.js';
import { estimateEdge } from '../ratings/edge-estimator.js';
import { estimateBreeam } from '../ratings/breeam-estimator.js';
import { assessEuTaxonomy } from '../credits/eu-taxonomy-alignment.js';
import { computeBngAssessment } from '../biodiversity/bng-calculator.js';
import { recommendNbs } from '../biodiversity/nbs-recommender.js';
import { suggestSbtnTargets } from '../biodiversity/sbtn-targets.js';
import {
  buildPropertyEsgReport,
  rollupCarbon,
} from '../advisor/property-esg-report.js';
import { rollupPortfolio } from '../advisor/portfolio-rollup.js';
import type {
  PropertyDescriptor,
  ReportingPeriod,
  PropertyEsg,
} from '../types.js';

const PERIOD: ReportingPeriod = {
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  financialYear: 'FY26',
};

function makeProperty(overrides: Partial<PropertyDescriptor> = {}): PropertyDescriptor {
  return {
    propertyId: 'p1',
    tenantId: 't1',
    country: 'KE',
    assetClass: 'office',
    climateZone: 'tropical_savanna',
    grossInternalArea_m2: 2_000,
    yearBuilt: 2020,
    stories: 4,
    occupancy: 200,
    allElectric: false,
    ...overrides,
  };
}

function buildReportFor(property: PropertyDescriptor): PropertyEsg {
  const s1 = computeScope1({
    fuels: [{ fuel: 'diesel_litre', quantity: 800 }],
    refrigerants: [{ refrigerant: 'HFC_410A', leakKg: 1 }],
  });
  const s2 = computeScope2({
    country: property.country,
    electricityKWh: 250_000,
    renewablesCertificatesKWh: 50_000,
  });
  const s3 = computeScope3({
    waste: [{ stream: 'mixed_msw_landfill', tonnes: 4 }],
    travel: [{ mode: 'flight_long_haul_economy', activity: 50_000 }],
  });
  const embodied = computeEmbodiedCarbon({
    grossInternalArea_m2: property.grossInternalArea_m2,
    quickArchetype: 'office_medium',
  });
  const carbon = rollupCarbon({
    propertyId: property.propertyId,
    period: PERIOD,
    grossInternalArea_m2: property.grossInternalArea_m2,
    scope1: s1,
    scope2: s2,
    scope3: s3,
    embodied,
  });

  const edge = estimateEdge({
    energyReductionPct: 30,
    waterReductionPct: 25,
    materialReductionPct: 22,
    remainingOpCarbonAfterOffsets: 5,
  });
  const breeam = estimateBreeam({
    operationalCarbonIntensity: carbon.intensityKgCO2ePerM2,
    embodiedIntensityPerM2: embodied.intensityPerM2,
    wasteDiversionPct: 75,
    waterUseLPerPersonDay: 120,
    publicTransportProximity: true,
    indoorEnvIndex: 0.8,
    ecologyNetGainAchieved: false,
    hasCemp: true,
    responsibleSourcingPct: 70,
    innovationCredits: 2,
  });
  const eu = assessEuTaxonomy({
    activity: '7.7',
    yearBuilt: property.yearBuilt,
    epcBand: 'B',
    inTop15PctOfStock: true,
    meetsNzebMinus10: false,
    wasteDiversionPct: 75,
    waterFittingsCompliant: true,
    vocLowEmissions: true,
    biodiversityScreenPasses: true,
    adaptationAssessmentDone: true,
    minimumSafeguards: true,
  });
  const bng = computeBngAssessment({
    siteName: 'p1-site',
    baseline: [{
      id: 'b1', habitatType: 'amenity grass', area_ha: 0.5,
      distinctiveness: 'LOW', condition: 'MODERATE',
      strategicSignificance: 'OUTSIDE',
    }],
    postDevelopment: [{
      id: 'd1', habitatType: 'pollinator strip', area_ha: 0.5,
      distinctiveness: 'MEDIUM', condition: 'GOOD',
      strategicSignificance: 'WITHIN_LOCAL_STRATEGY',
    }],
  });
  const nbs = recommendNbs({
    climate: property.climateZone,
    availableArea_m2: 400,
    availableBudget: 80_000,
    currency: 'KES',
    topN: 5,
  });
  const targets = suggestSbtnTargets({
    landConvertedHa: 0.1,
    waterWithdrawalM3: 1_500,
    waterStressed: false,
    emissionsIntensityKgM2: carbon.intensityKgCO2ePerM2,
    plannedBuildOutM2: 0,
    treeCoverHa: 0.05,
  });

  return buildPropertyEsgReport({
    property,
    period: PERIOD,
    carbon,
    ratings: [edge, breeam],
    euTaxonomy: eu,
    biodiversity: bng,
    nbsOpportunities: nbs,
    recommendedTargets: targets,
  });
}

describe('PropertyEsg report', () => {
  it('produces an executive summary with property id + period', () => {
    const report = buildReportFor(makeProperty());
    expect(report.executiveSummary).toContain('p1');
    expect(report.executiveSummary).toContain('FY26');
    expect(report.executiveSummary).toContain('tCO2e');
  });

  it('flags EAC-specific veteran note for KE assets', () => {
    const report = buildReportFor(makeProperty({ country: 'KE' }));
    const all = report.veteranAdvisorNotes.join('\n');
    expect(all).toMatch(/NEMA|NEMC|EAC|EDGE/i);
  });

  it('includes IFRS S2 / CSRD note for EU/UK assets', () => {
    const report = buildReportFor(makeProperty({ country: 'GB' }));
    const all = report.veteranAdvisorNotes.join('\n');
    expect(all).toMatch(/IFRS S2|CSRD|SDR/);
  });

  it('mentions stranded-asset risk when intensity > 80', () => {
    const property = makeProperty({ grossInternalArea_m2: 100 });
    const report = buildReportFor(property);
    const all = report.veteranAdvisorNotes.join('\n');
    expect(all.toLowerCase()).toContain('stranded');
  });

  it('rollupCarbon throws when GIA is zero', () => {
    expect(() => rollupCarbon({
      propertyId: 'p', period: PERIOD, grossInternalArea_m2: 0,
      scope1: computeScope1({ fuels: [], refrigerants: [] }),
      scope2: computeScope2({ country: 'GB', electricityKWh: 0 }),
      scope3: null, embodied: null,
    })).toThrow(/GIA/);
  });
});

describe('portfolio rollup', () => {
  it('handles empty portfolio gracefully', () => {
    const r = rollupPortfolio([]);
    expect(r.propertyCount).toBe(0);
    expect(r.totalOperationalKgCO2e).toBe(0);
  });

  it('aggregates by asset class with delta-vs-benchmark', () => {
    const a = buildReportFor(makeProperty({ propertyId: 'p1', assetClass: 'office' }));
    const b = buildReportFor(makeProperty({ propertyId: 'p2', assetClass: 'office' }));
    const r = rollupPortfolio([a, b], {
      medianIntensityKgM2: { office: 30 },
    });
    expect(r.propertyCount).toBe(2);
    expect(r.byAssetClass.office?.count).toBe(2);
    expect(r.byAssetClass.office?.deltaVsBenchmarkPct).not.toBeNull();
  });

  it('orders worst-performers descending by intensity', () => {
    const small = buildReportFor(makeProperty({ propertyId: 'small', grossInternalArea_m2: 100 }));
    const big = buildReportFor(makeProperty({ propertyId: 'big', grossInternalArea_m2: 10_000 }));
    const r = rollupPortfolio([small, big]);
    // Small property has higher intensity (same emissions / smaller GIA)
    expect(r.worstPerformers[0]?.propertyId).toBe('small');
  });

  it('omits benchmark delta when none supplied for a class', () => {
    const a = buildReportFor(makeProperty({ propertyId: 'p1', assetClass: 'industrial' }));
    const r = rollupPortfolio([a]);
    expect(r.byAssetClass.industrial?.benchmarkIntensityKgM2).toBeNull();
    expect(r.byAssetClass.industrial?.deltaVsBenchmarkPct).toBeNull();
  });
});
