/**
 * scoring-model unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRADING_WEIGHTS,
  GRADE_ORDER,
  AssetGradeInputs,
} from '../asset-grading-types.js';
import {
  scoreAsset,
  scoreToGrade,
  validateWeights,
} from '../scoring-model.js';

const BASE_INPUTS: AssetGradeInputs = Object.freeze({
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  utilisationRate: 0.95,
  royaltyCollectionRate: 0.98,
  noi: 900_000,
  grossPotentialIncome: 1_500_000,
  expenseRatio: 0.3,
  outstandingRoyaltyRatio: 0.02,
  avgMaintenanceResolutionHours: 8,
  maintenanceCostPerSite: 12_000,
  complianceBreachCount: 0,
  buyerSatisfactionProxy: 0.94,
  downtimeDays: 5,
  capexDebt: 0,
  marketPriceRatio: 1.05,
  assetAge: 3,
  siteCount: 10,
});

describe('scoreToGrade', () => {
  it.each([
    [95, 'A_PLUS'],
    [89, 'A'],
    [84, 'A_MINUS'],
    [80, 'B_PLUS'],
    [76, 'B'],
    [70, 'B_MINUS'],
    [65, 'C_PLUS'],
    [60, 'C'],
    [55, 'C_MINUS'],
    [50, 'D_PLUS'],
    [42, 'D'],
    [20, 'F'],
  ])('maps score %i → %s', (score, grade) => {
    expect(scoreToGrade(score)).toBe(grade);
  });

  it('clamps out-of-range input', () => {
    expect(scoreToGrade(200)).toBe('A_PLUS');
    expect(scoreToGrade(-5)).toBe('F');
  });
});

describe('validateWeights', () => {
  it('accepts the default weights', () => {
    expect(() => validateWeights(DEFAULT_GRADING_WEIGHTS)).not.toThrow();
  });

  it('rejects weights that do not sum to 1.0', () => {
    expect(() =>
      validateWeights({
        royalty_yield: 0.5,
        opex_efficiency: 0.2,
        maintenance: 0.2,
        recovery: 0.15,
        royalty_compliance: 0.1,
        buyer_quality: 0.1,
      }),
    ).toThrow(/sum to 1\.0/);
  });

  it('rejects negative weights', () => {
    expect(() =>
      validateWeights({
        royalty_yield: -0.1,
        opex_efficiency: 0.3,
        maintenance: 0.2,
        recovery: 0.25,
        royalty_compliance: 0.2,
        buyer_quality: 0.15,
      }),
    ).toThrow();
  });
});

describe('scoreAsset — grade levels', () => {
  it('excellent inputs earn an A grade family', () => {
    const r = scoreAsset(BASE_INPUTS);
    expect(GRADE_ORDER.slice(0, 3)).toContain(r.grade);
    expect(r.score).toBeGreaterThan(83);
  });

  it('decent inputs earn a B or A- family', () => {
    const r = scoreAsset({
      ...BASE_INPUTS,
      utilisationRate: 0.82,
      royaltyCollectionRate: 0.88,
      expenseRatio: 0.5,
      buyerSatisfactionProxy: 0.78,
      marketPriceRatio: 0.92,
      avgMaintenanceResolutionHours: 36,
    });
    expect(['A_MINUS', 'B_PLUS', 'B', 'B_MINUS']).toContain(r.grade);
  });

  it('struggling inputs earn a C or low-B family', () => {
    const r = scoreAsset({
      ...BASE_INPUTS,
      utilisationRate: 0.7,
      royaltyCollectionRate: 0.75,
      expenseRatio: 0.6,
      outstandingRoyaltyRatio: 0.15,
      buyerSatisfactionProxy: 0.6,
      avgMaintenanceResolutionHours: 96,
      maintenanceCostPerSite: 80_000,
      marketPriceRatio: 0.82,
      complianceBreachCount: 1,
    });
    expect(['B_MINUS', 'C_PLUS', 'C', 'C_MINUS', 'D_PLUS']).toContain(r.grade);
  });

  it('poor inputs collapse to D or F', () => {
    const r = scoreAsset({
      ...BASE_INPUTS,
      utilisationRate: 0.4,
      royaltyCollectionRate: 0.5,
      expenseRatio: 0.75,
      outstandingRoyaltyRatio: 0.3,
      complianceBreachCount: 3,
      buyerSatisfactionProxy: 0.3,
      avgMaintenanceResolutionHours: 200,
      maintenanceCostPerSite: 200_000,
      marketPriceRatio: 0.6,
      capexDebt: 5_000_000,
    });
    expect(['D_PLUS', 'D', 'F']).toContain(r.grade);
  });

  it('populates all six dimensions', () => {
    const r = scoreAsset(BASE_INPUTS);
    expect(Object.keys(r.dimensions).sort()).toEqual(
      ['buyer_quality', 'maintenance', 'opex_efficiency', 'recovery', 'royalty_compliance', 'royalty_yield'],
    );
  });

  it('produces at least one reason', () => {
    const r = scoreAsset(BASE_INPUTS);
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('adding compliance breaches deducts 15 pts per breach', () => {
    const clean = scoreAsset(BASE_INPUTS).dimensions.royalty_compliance.score;
    const breaches = scoreAsset({ ...BASE_INPUTS, complianceBreachCount: 2 })
      .dimensions.royalty_compliance.score;
    expect(breaches).toBeLessThanOrEqual(clean - 30);
  });
});

describe('scoreAsset — weight sensitivity', () => {
  it('shifting all weight to maintenance yanks the grade down when maintenance is poor', () => {
    const maintenancePoor: AssetGradeInputs = {
      ...BASE_INPUTS,
      avgMaintenanceResolutionHours: 300,
      maintenanceCostPerSite: 180_000,
      capexDebt: 8_000_000,
    };
    const defaultReport = scoreAsset(maintenancePoor);
    const heavyMaintenance = scoreAsset(maintenancePoor, {
      royalty_yield: 0.05,
      opex_efficiency: 0.05,
      maintenance: 0.7,
      recovery: 0.05,
      royalty_compliance: 0.1,
      buyer_quality: 0.05,
    });
    expect(heavyMaintenance.score).toBeLessThan(defaultReport.score);
  });

  it('shifting weight toward a strong dimension raises the grade', () => {
    const strongYield: AssetGradeInputs = {
      ...BASE_INPUTS,
      expenseRatio: 0.65,
      avgMaintenanceResolutionHours: 140,
    };
    const defaultReport = scoreAsset(strongYield);
    const heavyYield = scoreAsset(strongYield, {
      royalty_yield: 0.6,
      opex_efficiency: 0.05,
      maintenance: 0.05,
      recovery: 0.1,
      royalty_compliance: 0.1,
      buyer_quality: 0.1,
    });
    expect(heavyYield.score).toBeGreaterThan(defaultReport.score);
  });

  it('is pure — same inputs always produce same score', () => {
    const a = scoreAsset(BASE_INPUTS);
    const b = scoreAsset(BASE_INPUTS);
    expect(a.score).toBe(b.score);
    expect(a.grade).toBe(b.grade);
  });

  it('does not mutate the inputs or weights objects', () => {
    const snapshot = JSON.stringify(BASE_INPUTS);
    const weightSnapshot = JSON.stringify(DEFAULT_GRADING_WEIGHTS);
    scoreAsset(BASE_INPUTS, DEFAULT_GRADING_WEIGHTS);
    expect(JSON.stringify(BASE_INPUTS)).toBe(snapshot);
    expect(JSON.stringify(DEFAULT_GRADING_WEIGHTS)).toBe(weightSnapshot);
  });
});
