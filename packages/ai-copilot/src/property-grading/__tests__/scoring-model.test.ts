/**
 * scoring-model unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRADING_WEIGHTS,
  GRADE_ORDER,
  PropertyGradeInputs,
} from '../property-grading-types.js';
import {
  scoreProperty,
  scoreToGrade,
  validateWeights,
} from '../scoring-model.js';

const BASE_INPUTS: PropertyGradeInputs = Object.freeze({
  propertyId: 'prop-1',
  tenantId: 'tenant-1',
  occupancyRate: 0.95,
  rentCollectionRate: 0.98,
  noi: 900_000,
  grossPotentialIncome: 1_500_000,
  expenseRatio: 0.3,
  arrearsRatio: 0.02,
  avgMaintenanceResolutionHours: 8,
  maintenanceCostPerUnit: 12_000,
  complianceBreachCount: 0,
  tenantSatisfactionProxy: 0.94,
  vacancyDurationDays: 5,
  capexDebt: 0,
  marketRentRatio: 1.05,
  propertyAge: 3,
  unitCount: 10,
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
        income: 0.5,
        expense: 0.2,
        maintenance: 0.2,
        occupancy: 0.15,
        compliance: 0.1,
        tenant: 0.1,
      }),
    ).toThrow(/sum to 1\.0/);
  });

  it('rejects negative weights', () => {
    expect(() =>
      validateWeights({
        income: -0.1,
        expense: 0.3,
        maintenance: 0.2,
        occupancy: 0.25,
        compliance: 0.2,
        tenant: 0.15,
      }),
    ).toThrow();
  });
});

describe('scoreProperty — grade levels', () => {
  it('excellent inputs earn an A grade family', () => {
    const r = scoreProperty(BASE_INPUTS);
    expect(GRADE_ORDER.slice(0, 3)).toContain(r.grade);
    expect(r.score).toBeGreaterThan(83);
  });

  it('decent inputs earn a B or A- family', () => {
    const r = scoreProperty({
      ...BASE_INPUTS,
      occupancyRate: 0.82,
      rentCollectionRate: 0.88,
      expenseRatio: 0.5,
      tenantSatisfactionProxy: 0.78,
      marketRentRatio: 0.92,
      avgMaintenanceResolutionHours: 36,
    });
    expect(['A_MINUS', 'B_PLUS', 'B', 'B_MINUS']).toContain(r.grade);
  });

  it('struggling inputs earn a C or low-B family', () => {
    const r = scoreProperty({
      ...BASE_INPUTS,
      occupancyRate: 0.7,
      rentCollectionRate: 0.75,
      expenseRatio: 0.6,
      arrearsRatio: 0.15,
      tenantSatisfactionProxy: 0.6,
      avgMaintenanceResolutionHours: 96,
      maintenanceCostPerUnit: 80_000,
      marketRentRatio: 0.82,
      complianceBreachCount: 1,
    });
    expect(['B_MINUS', 'C_PLUS', 'C', 'C_MINUS', 'D_PLUS']).toContain(r.grade);
  });

  it('poor inputs collapse to D or F', () => {
    const r = scoreProperty({
      ...BASE_INPUTS,
      occupancyRate: 0.4,
      rentCollectionRate: 0.5,
      expenseRatio: 0.75,
      arrearsRatio: 0.3,
      complianceBreachCount: 3,
      tenantSatisfactionProxy: 0.3,
      avgMaintenanceResolutionHours: 200,
      maintenanceCostPerUnit: 200_000,
      marketRentRatio: 0.6,
      capexDebt: 5_000_000,
    });
    expect(['D_PLUS', 'D', 'F']).toContain(r.grade);
  });

  it('populates all six dimensions', () => {
    const r = scoreProperty(BASE_INPUTS);
    expect(Object.keys(r.dimensions).sort()).toEqual(
      ['compliance', 'expense', 'income', 'maintenance', 'occupancy', 'tenant'],
    );
  });

  it('produces at least one reason', () => {
    const r = scoreProperty(BASE_INPUTS);
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('adding compliance breaches deducts 15 pts per breach', () => {
    const clean = scoreProperty(BASE_INPUTS).dimensions.compliance.score;
    const breaches = scoreProperty({ ...BASE_INPUTS, complianceBreachCount: 2 })
      .dimensions.compliance.score;
    expect(breaches).toBeLessThanOrEqual(clean - 30);
  });
});

describe('scoreProperty — weight sensitivity', () => {
  it('shifting all weight to maintenance yanks the grade down when maintenance is poor', () => {
    const maintenancePoor: PropertyGradeInputs = {
      ...BASE_INPUTS,
      avgMaintenanceResolutionHours: 300,
      maintenanceCostPerUnit: 180_000,
      capexDebt: 8_000_000,
    };
    const defaultReport = scoreProperty(maintenancePoor);
    const heavyMaintenance = scoreProperty(maintenancePoor, {
      income: 0.05,
      expense: 0.05,
      maintenance: 0.7,
      occupancy: 0.05,
      compliance: 0.1,
      tenant: 0.05,
    });
    expect(heavyMaintenance.score).toBeLessThan(defaultReport.score);
  });

  it('shifting weight toward a strong dimension raises the grade', () => {
    const strongIncome: PropertyGradeInputs = {
      ...BASE_INPUTS,
      expenseRatio: 0.65,
      avgMaintenanceResolutionHours: 140,
    };
    const defaultReport = scoreProperty(strongIncome);
    const heavyIncome = scoreProperty(strongIncome, {
      income: 0.6,
      expense: 0.05,
      maintenance: 0.05,
      occupancy: 0.1,
      compliance: 0.1,
      tenant: 0.1,
    });
    expect(heavyIncome.score).toBeGreaterThan(defaultReport.score);
  });

  it('is pure — same inputs always produce same score', () => {
    const a = scoreProperty(BASE_INPUTS);
    const b = scoreProperty(BASE_INPUTS);
    expect(a.score).toBe(b.score);
    expect(a.grade).toBe(b.grade);
  });

  it('does not mutate the inputs or weights objects', () => {
    const snapshot = JSON.stringify(BASE_INPUTS);
    const weightSnapshot = JSON.stringify(DEFAULT_GRADING_WEIGHTS);
    scoreProperty(BASE_INPUTS, DEFAULT_GRADING_WEIGHTS);
    expect(JSON.stringify(BASE_INPUTS)).toBe(snapshot);
    expect(JSON.stringify(DEFAULT_GRADING_WEIGHTS)).toBe(weightSnapshot);
  });
});
