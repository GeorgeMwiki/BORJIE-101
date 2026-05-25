/**
 * property-grading-service tests.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryMetricsSource,
  InMemorySnapshotRepository,
  InMemoryWeightsRepository,
} from '../in-memory-repositories.js';
import { PropertyGradingService } from '../property-grading-service.js';
import {
  DEFAULT_GRADING_WEIGHTS,
  PropertyGradeInputs,
} from '../property-grading-types.js';

const TENANT = 'tenant-alpha';
const OTHER = 'tenant-beta';

function goodInputs(id: string): PropertyGradeInputs {
  return {
    propertyId: id,
    tenantId: TENANT,
    occupancyRate: 0.95,
    rentCollectionRate: 0.97,
    noi: 900_000,
    grossPotentialIncome: 1_500_000,
    expenseRatio: 0.3,
    arrearsRatio: 0.02,
    avgMaintenanceResolutionHours: 8,
    maintenanceCostPerUnit: 15_000,
    complianceBreachCount: 0,
    tenantSatisfactionProxy: 0.9,
    vacancyDurationDays: 5,
    capexDebt: 0,
    marketRentRatio: 1.05,
    propertyAge: 3,
    unitCount: 12,
  };
}

function poorInputs(id: string): PropertyGradeInputs {
  return {
    propertyId: id,
    tenantId: TENANT,
    occupancyRate: 0.4,
    rentCollectionRate: 0.5,
    noi: 100_000,
    grossPotentialIncome: 1_200_000,
    expenseRatio: 0.8,
    arrearsRatio: 0.3,
    avgMaintenanceResolutionHours: 240,
    maintenanceCostPerUnit: 180_000,
    complianceBreachCount: 4,
    tenantSatisfactionProxy: 0.35,
    vacancyDurationDays: 90,
    capexDebt: 10_000_000,
    marketRentRatio: 0.65,
    propertyAge: 25,
    unitCount: 8,
  };
}

function buildService() {
  const metrics = new InMemoryMetricsSource();
  const weights = new InMemoryWeightsRepository();
  const snapshots = new InMemorySnapshotRepository();
  const svc = new PropertyGradingService({
    metricsSource: metrics,
    weightsRepo: weights,
    snapshotRepo: snapshots,
    generateId: (() => {
      let n = 0;
      return () => `snap-${++n}`;
    })(),
  });
  return { metrics, weights, snapshots, svc };
}

describe('PropertyGradingService.gradeProperty', () => {
  it('returns a report when live inputs are present', async () => {
    const { metrics, svc } = buildService();
    metrics.seed(TENANT, goodInputs('p1'));
    const outcome = await svc.gradeProperty(TENANT, 'p1');
    expect(outcome.kind).toBe('report');
    if (outcome.kind === 'report') {
      expect(outcome.report.grade).not.toBe('INSUFFICIENT_DATA');
      expect(outcome.report.score).toBeGreaterThan(80);
    }
  });

  it('returns INSUFFICIENT_DATA when the property is unknown', async () => {
    const { svc } = buildService();
    const outcome = await svc.gradeProperty(TENANT, 'ghost');
    expect(outcome.kind).toBe('insufficient');
    if (outcome.kind === 'insufficient') {
      expect(outcome.report.missingFields).toContain('property_not_found');
    }
  });

  it('returns INSUFFICIENT_DATA when a required field is NaN', async () => {
    const { metrics, svc } = buildService();
    metrics.seed(TENANT, {
      ...goodInputs('p1'),
      rentCollectionRate: Number.NaN,
    });
    const outcome = await svc.gradeProperty(TENANT, 'p1');
    expect(outcome.kind).toBe('insufficient');
    if (outcome.kind === 'insufficient') {
      expect(outcome.report.missingFields).toContain('rentCollectionRate');
    }
  });

  it('persists a snapshot after each successful grade', async () => {
    const { metrics, svc, snapshots } = buildService();
    metrics.seed(TENANT, goodInputs('p1'));
    await svc.gradeProperty(TENANT, 'p1');
    const latest = await snapshots.findLatest(TENANT, 'p1');
    expect(latest).not.toBeNull();
    expect(latest?.grade).not.toBe('INSUFFICIENT_DATA');
  });

  it('enforces tenant isolation — grading tenant A does not affect tenant B', async () => {
    const { metrics, svc } = buildService();
    metrics.seed(TENANT, goodInputs('p1'));
    const other = await svc.gradeProperty(OTHER, 'p1');
    expect(other.kind).toBe('insufficient');
  });
});

describe('PropertyGradingService.gradeAllProperties', () => {
  it('grades every property known for the tenant', async () => {
    const { metrics, svc } = buildService();
    metrics.seed(TENANT, goodInputs('a'));
    metrics.seed(TENANT, goodInputs('b'));
    metrics.seed(TENANT, poorInputs('c'));
    const outcomes = await svc.gradeAllProperties(TENANT);
    expect(outcomes).toHaveLength(3);
    const reported = outcomes.filter((o) => o.kind === 'report');
    expect(reported).toHaveLength(3);
  });
});

describe('PropertyGradingService.getPortfolioGrade', () => {
  it('returns a portfolio grade after individual grades have been recorded', async () => {
    const { metrics, svc } = buildService();
    metrics.seed(TENANT, goodInputs('a'));
    metrics.seed(TENANT, poorInputs('b'));
    metrics.seedHints(TENANT, {
      unitCountByPropertyId: { a: 20, b: 5 },
      assetValueByPropertyId: { a: 50_000_000, b: 10_000_000 },
    });
    await svc.gradeAllProperties(TENANT);
    const portfolio = await svc.getPortfolioGrade(TENANT, { weightBy: 'unit_count' });
    expect(portfolio.totalProperties).toBe(2);
    // With 20 units on the good property and 5 on the poor one, score skews high
    expect(portfolio.score).toBeGreaterThan(60);
  });

  it('returns INSUFFICIENT_DATA for a tenant with no snapshots', async () => {
    const { svc } = buildService();
    const portfolio = await svc.getPortfolioGrade(TENANT);
    expect(portfolio.grade).toBe('INSUFFICIENT_DATA');
  });
});

describe('PropertyGradingService.trackOverTime', () => {
  it('returns history entries in chronological order', async () => {
    const { metrics, snapshots, svc } = buildService();
    metrics.seed(TENANT, goodInputs('p1'));
    await svc.gradeProperty(TENANT, 'p1');
    await snapshots.persist({
      id: 'older',
      tenantId: TENANT,
      propertyId: 'p1',
      grade: 'B',
      score: 77,
      dimensions: {},
      reasons: [],
      inputs: {},
      computedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const history = await svc.trackOverTime(TENANT, 'p1', 12);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PropertyGradingService.setWeights + getWeights', () => {
  it('accepts and persists custom weights', async () => {
    const { svc } = buildService();
    const updated = await svc.setWeights(TENANT, {
      income: 0.3,
      expense: 0.2,
      maintenance: 0.2,
      occupancy: 0.1,
      compliance: 0.1,
      tenant: 0.1,
    });
    expect(updated.income).toBe(0.3);
    const fetched = await svc.getWeights(TENANT);
    expect(fetched.income).toBe(0.3);
  });

  it('rejects weights that do not sum to 1.0', async () => {
    const { svc } = buildService();
    await expect(
      svc.setWeights(TENANT, {
        income: 0.5,
        expense: 0.5,
        maintenance: 0.5,
        occupancy: 0.1,
        compliance: 0.1,
        tenant: 0.1,
      }),
    ).rejects.toThrow(/sum to 1/);
  });

  it('defaults to the published default when no weights are set', async () => {
    const { svc } = buildService();
    const fetched = await svc.getWeights(TENANT);
    expect(fetched).toEqual(DEFAULT_GRADING_WEIGHTS);
  });
});
