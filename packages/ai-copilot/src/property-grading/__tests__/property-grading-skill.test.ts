/**
 * property-grading skill tests.
 *
 * The skill wraps the pure scoring function and returns a structured
 * `property_grade_card` block for the chat UI.
 */

import { describe, it, expect } from 'vitest';
import {
  gradePropertyTool,
  gradePortfolio,
  GradePropertyParamsSchema,
} from '../../skills/estate/property-grading.js';

const PROPERTY = {
  propertyId: 'p1',
  tenantId: 't1',
  occupancyRate: 0.9,
  rentCollectionRate: 0.95,
  noi: 500_000,
  grossPotentialIncome: 1_000_000,
  expenseRatio: 0.35,
  arrearsRatio: 0.03,
  avgMaintenanceResolutionHours: 24,
  maintenanceCostPerUnit: 20_000,
  complianceBreachCount: 0,
  tenantSatisfactionProxy: 0.85,
  vacancyDurationDays: 10,
  capexDebt: 100_000,
  marketRentRatio: 1.0,
  propertyAge: 5,
  unitCount: 15,
};

describe('gradePropertyTool', () => {
  it('has the expected name', () => {
    expect(gradePropertyTool.name).toBe('skill.estate.grade_property');
  });

  it('returns ok on a valid single-property call', async () => {
    const r = await gradePropertyTool.execute(
      { mode: 'single', properties: [PROPERTY] },
      {} as never,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.blocks?.[0]?.type).toBe('property_grade_card');
    }
  });

  it('returns a portfolio block when mode=portfolio', async () => {
    const r = await gradePropertyTool.execute(
      {
        mode: 'portfolio',
        weightBy: 'unit_count',
        properties: [PROPERTY, { ...PROPERTY, propertyId: 'p2', unitCount: 5 }],
      },
      {} as never,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const payload = (r.blocks?.[0]?.payload ?? {}) as Record<string, unknown>;
      expect(payload.scope).toBe('portfolio');
      expect(payload.totalProperties).toBe(2);
    }
  });

  it('rejects payloads with zero properties', () => {
    expect(() =>
      GradePropertyParamsSchema.parse({ properties: [] }),
    ).toThrow();
  });

  it('rejects weights that do not sum to 1', async () => {
    const r = await gradePropertyTool.execute(
      {
        mode: 'single',
        properties: [PROPERTY],
        weights: {
          income: 0.5,
          expense: 0.5,
          maintenance: 0.5,
          occupancy: 0.5,
          compliance: 0.5,
          tenant: 0.5,
        },
      },
      {} as never,
    );
    expect(r.ok).toBe(false);
  });
});

describe('gradePortfolio (pure)', () => {
  it('returns trajectory when previous score is supplied', () => {
    const result = gradePortfolio({
      mode: 'portfolio',
      properties: [PROPERTY, { ...PROPERTY, propertyId: 'p2', unitCount: 8 }],
      previousPortfolioScore: 70,
    });
    expect(result.portfolio?.trajectory?.direction).toMatch(/up|down|flat/);
  });
});
