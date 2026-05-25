/**
 * portfolio-aggregator tests.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregatePortfolioGrade,
  collapseDistributionByFamily,
} from '../portfolio-aggregator.js';
import {
  DEFAULT_GRADING_WEIGHTS,
  PropertyGradeReport,
} from '../property-grading-types.js';

function reportOf(id: string, score: number): PropertyGradeReport {
  const grade =
    score >= 88 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return {
    propertyId: id,
    tenantId: 'tenant-1',
    grade,
    score,
    dimensions: {
      income: { dimension: 'income', score, grade, explanation: '' },
      expense: { dimension: 'expense', score, grade, explanation: '' },
      maintenance: { dimension: 'maintenance', score, grade, explanation: '' },
      occupancy: { dimension: 'occupancy', score, grade, explanation: '' },
      compliance: { dimension: 'compliance', score, grade, explanation: '' },
      tenant: { dimension: 'tenant', score, grade, explanation: '' },
    },
    reasons: [],
    weights: DEFAULT_GRADING_WEIGHTS,
    computedAt: new Date().toISOString(),
  };
}

describe('aggregatePortfolioGrade', () => {
  const reports = [
    reportOf('A1', 90),
    reportOf('B1', 78),
    reportOf('C1', 65),
    reportOf('D1', 45),
  ];

  it('equal-weight yields the mean score', () => {
    const p = aggregatePortfolioGrade('tenant-1', reports, { weightBy: 'equal' });
    // (90+78+65+45)/4 = 69.5
    expect(p.score).toBeCloseTo(69.5, 1);
  });

  it('unit-count weighting shifts the score toward larger properties', () => {
    const p = aggregatePortfolioGrade('tenant-1', reports, {
      weightBy: 'unit_count',
      weightsByPropertyId: { A1: 50, B1: 10, C1: 5, D1: 1 },
    });
    // 90 is weighted 50/66 — expect score > equal-weight mean
    expect(p.score).toBeGreaterThan(85);
  });

  it('asset-value weighting changes the result independently', () => {
    const p = aggregatePortfolioGrade('tenant-1', reports, {
      weightBy: 'asset_value',
      weightsByPropertyId: { A1: 1, B1: 1, C1: 1, D1: 100 },
    });
    expect(p.score).toBeLessThan(60);
  });

  it('builds a distribution count across every grade slot', () => {
    const p = aggregatePortfolioGrade('tenant-1', reports, { weightBy: 'equal' });
    expect(p.distribution.A).toBe(1);
    expect(p.distribution.B).toBe(1);
    expect(p.distribution.C).toBe(1);
    expect(p.distribution.D).toBe(1);
  });

  it('returns top-3 strengths and weaknesses', () => {
    const big = [reportOf('a', 95), reportOf('b', 88), reportOf('c', 70), reportOf('d', 50), reportOf('e', 42)];
    const p = aggregatePortfolioGrade('tenant-1', big);
    expect(p.topStrengths.map((r) => r.propertyId)).toEqual(['a', 'b', 'c']);
    expect(p.topWeaknesses.map((r) => r.propertyId)).toEqual(['e', 'd', 'c']);
  });

  it('INSUFFICIENT_DATA properties bypass the score but are counted in distribution', () => {
    const withMissing: PropertyGradeReport[] = [
      reportOf('a', 85),
      {
        ...reportOf('b', 0),
        grade: 'INSUFFICIENT_DATA',
      },
    ];
    const p = aggregatePortfolioGrade('tenant-1', withMissing, { weightBy: 'equal' });
    expect(p.distribution.INSUFFICIENT_DATA).toBe(1);
    expect(p.score).toBe(85);
  });

  it('returns INSUFFICIENT_DATA when portfolio is empty', () => {
    const p = aggregatePortfolioGrade('tenant-1', []);
    expect(p.grade).toBe('INSUFFICIENT_DATA');
  });

  it('trajectory computes delta + direction from previous score', () => {
    const p = aggregatePortfolioGrade('tenant-1', reports, {
      weightBy: 'equal',
      previousScore: 65,
    });
    expect(p.trajectory?.delta).toBeCloseTo(4.5, 1);
    expect(p.trajectory?.direction).toBe('up');
  });
});

describe('collapseDistributionByFamily', () => {
  it('collapses A+/A/A- into A', () => {
    const dist = {
      A_PLUS: 2,
      A: 1,
      A_MINUS: 1,
      B_PLUS: 0,
      B: 3,
      B_MINUS: 1,
      C_PLUS: 0,
      C: 0,
      C_MINUS: 0,
      D_PLUS: 0,
      D: 1,
      F: 0,
      INSUFFICIENT_DATA: 0,
    };
    const collapsed = collapseDistributionByFamily(dist);
    expect(collapsed.A).toBe(4);
    expect(collapsed.B).toBe(4);
    expect(collapsed.D).toBe(1);
  });
});
