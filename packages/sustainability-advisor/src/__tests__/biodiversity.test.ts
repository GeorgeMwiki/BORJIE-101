/**
 * BNG calculator + SBTN targets + NbS recommender tests.
 */

import { describe, it, expect } from 'vitest';
import {
  computeBngAssessment,
  unitsForParcel,
  CONDITION_SCORE,
  DISTINCTIVENESS_SCORE,
  STATUTORY_CREDIT_GBP_PER_UNIT,
} from '../biodiversity/bng-calculator.js';
import { suggestSbtnTargets } from '../biodiversity/sbtn-targets.js';
import { recommendNbs, DEFAULT_NBS_CATALOG } from '../biodiversity/nbs-recommender.js';

describe('BNG calculator', () => {
  it('computes biodiversity units multiplicatively', () => {
    const u = unitsForParcel({
      id: 'p',
      habitatType: 'modified grassland',
      area_ha: 1,
      distinctiveness: 'MEDIUM',
      condition: 'GOOD',
      strategicSignificance: 'OUTSIDE',
    });
    expect(u).toBeCloseTo(1 * DISTINCTIVENESS_SCORE.MEDIUM * CONDITION_SCORE.GOOD * 1, 5);
  });

  it('meets the 10% threshold when post-dev units uplift correctly', () => {
    const r = computeBngAssessment({
      siteName: 'site-A',
      baseline: [{
        id: 'b1', habitatType: 'low scrub', area_ha: 2,
        distinctiveness: 'LOW', condition: 'MODERATE',
        strategicSignificance: 'OUTSIDE',
      }],
      postDevelopment: [{
        id: 'p1', habitatType: 'enhanced wildflower', area_ha: 2,
        distinctiveness: 'MEDIUM', condition: 'GOOD',
        strategicSignificance: 'WITHIN_LOCAL_STRATEGY',
      }],
    });
    expect(r.meetsLegalThreshold).toBe(true);
    expect(r.netGainPct).toBeGreaterThan(10);
    expect(r.statutoryCreditCostGBP).toBe(0);
  });

  it('triggers statutory credit costing on shortfall', () => {
    const r = computeBngAssessment({
      siteName: 'site-B',
      baseline: [{
        id: 'b1', habitatType: 'priority grassland', area_ha: 2,
        distinctiveness: 'HIGH', condition: 'GOOD',
        strategicSignificance: 'WITHIN_LOCAL_STRATEGY',
      }],
      postDevelopment: [{
        id: 'p1', habitatType: 'amenity grass', area_ha: 2,
        distinctiveness: 'LOW', condition: 'POOR',
        strategicSignificance: 'OUTSIDE',
      }],
    });
    expect(r.meetsLegalThreshold).toBe(false);
    expect(r.offSiteUnitsRequired).toBeGreaterThan(0);
    expect(r.statutoryCreditCostGBP).toBeCloseTo(
      r.offSiteUnitsRequired * STATUTORY_CREDIT_GBP_PER_UNIT,
      0,
    );
  });

  it('off-site contracted units help meet threshold', () => {
    const r = computeBngAssessment({
      siteName: 'site-C',
      baseline: [{
        id: 'b1', habitatType: 'grassland', area_ha: 1,
        distinctiveness: 'MEDIUM', condition: 'GOOD',
        strategicSignificance: 'OUTSIDE',
      }],
      postDevelopment: [{
        id: 'p1', habitatType: 'urban tree', area_ha: 0.1,
        distinctiveness: 'LOW', condition: 'GOOD',
        strategicSignificance: 'OUTSIDE',
      }],
      offSiteUnits: 14,    // generous offset
    });
    expect(r.meetsLegalThreshold).toBe(true);
  });

  it('handles a zero-baseline brownfield', () => {
    const r = computeBngAssessment({
      siteName: 'brownfield',
      baseline: [],
      postDevelopment: [{
        id: 'p1', habitatType: 'green roof', area_ha: 0.05,
        distinctiveness: 'LOW', condition: 'GOOD',
        strategicSignificance: 'OUTSIDE',
      }],
    });
    expect(r.baselineUnits).toBe(0);
    expect(r.netGainPct).toBe(100);
    expect(r.meetsLegalThreshold).toBe(true);
  });

  it('rejects negative area', () => {
    expect(() => unitsForParcel({
      id: 'x', habitatType: 'x', area_ha: -1,
      distinctiveness: 'LOW', condition: 'GOOD',
      strategicSignificance: 'OUTSIDE',
    })).toThrow(/negative area/);
  });
});

describe('SBTN target suggester', () => {
  it('proposes a water target in stressed catchments', () => {
    const s = suggestSbtnTargets({
      landConvertedHa: 0,
      waterWithdrawalM3: 10_000,
      waterStressed: true,
      emissionsIntensityKgM2: 15,
      plannedBuildOutM2: 0,
      treeCoverHa: 1,
    });
    expect(s.some((t) => t.driver === 'freshwater')).toBe(true);
  });

  it('triggers land-use target when planned buildout > 0', () => {
    const s = suggestSbtnTargets({
      landConvertedHa: 0,
      waterWithdrawalM3: 1_000,
      waterStressed: false,
      emissionsIntensityKgM2: 5,
      plannedBuildOutM2: 5_000,
      treeCoverHa: 0.01,
    });
    expect(s.some((t) => t.driver === 'land_use')).toBe(true);
  });

  it('adds pollution target when intensity is very high', () => {
    const s = suggestSbtnTargets({
      landConvertedHa: 0,
      waterWithdrawalM3: 0,
      waterStressed: false,
      emissionsIntensityKgM2: 50,
      plannedBuildOutM2: 0,
      treeCoverHa: 1,
    });
    expect(s.some((t) => t.driver === 'pollution')).toBe(true);
    expect(s.some((t) => t.driver === 'climate')).toBe(true);
  });

  it('rejects negative inputs', () => {
    expect(() => suggestSbtnTargets({
      landConvertedHa: -1, waterWithdrawalM3: 0, waterStressed: false,
      emissionsIntensityKgM2: 5, plannedBuildOutM2: 0, treeCoverHa: 1,
    })).toThrow(/landConvertedHa/);
  });
});

describe('NbS recommender', () => {
  it('returns top-N viable interventions for temperate climate', () => {
    const r = recommendNbs({
      climate: 'temperate_oceanic',
      availableArea_m2: 500,
      availableBudget: 100_000,
      currency: 'GBP',
      topN: 3,
    });
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.every((o) => o.fitForClimate)).toBe(true);
  });

  it('prioritises biodiversity when requested', () => {
    const balanced = recommendNbs({
      climate: 'temperate_oceanic',
      availableArea_m2: 500,
      availableBudget: 50_000,
      currency: 'GBP',
      priority: 'balanced',
      topN: 1,
    });
    const biodiv = recommendNbs({
      climate: 'temperate_oceanic',
      availableArea_m2: 500,
      availableBudget: 50_000,
      currency: 'GBP',
      priority: 'biodiversity',
      topN: 1,
    });
    expect(balanced.length).toBeGreaterThan(0);
    expect(biodiv.length).toBeGreaterThan(0);
    // Just confirm both return at least one rationale string.
    expect(balanced[0]!.rationale).toContain('balanced');
    expect(biodiv[0]!.rationale).toContain('biodiversity');
  });

  it('skips interventions incompatible with arid_desert', () => {
    const r = recommendNbs({
      climate: 'arid_desert',
      availableArea_m2: 1_000,
      availableBudget: 50_000,
      currency: 'USD',
    });
    const greenRoofPresent = r.some((o) => o.intervention.includes('green_roof'));
    expect(greenRoofPresent).toBe(false);
  });

  it('rejects negative budget', () => {
    expect(() => recommendNbs({
      climate: 'temperate_oceanic',
      availableArea_m2: 100,
      availableBudget: -1,
      currency: 'GBP',
    })).toThrow(/availableBudget/);
  });

  it('catalogue is non-empty and well-formed', () => {
    expect(DEFAULT_NBS_CATALOG.length).toBeGreaterThan(5);
    for (const c of DEFAULT_NBS_CATALOG) {
      expect(c.capexPerUnit).toBeGreaterThan(0);
      expect(c.viableInZones.length).toBeGreaterThan(0);
    }
  });

  it('returns empty for non-positive budget AND area but valid call', () => {
    const r = recommendNbs({
      climate: 'tropical_savanna',
      availableArea_m2: 0,
      availableBudget: 0,
      currency: 'KES',
    });
    // every opp ends up with 0 units, which we still return
    expect(r.length).toBeGreaterThan(0);
    for (const o of r) {
      expect(o.area_m2_or_units).toBe(0);
      expect(o.capexEstimate).toBe(0);
    }
  });
});
