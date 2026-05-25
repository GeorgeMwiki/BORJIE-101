/**
 * Tests for the tenant screening risk model. Pure deterministic
 * transform — fully testable from synthetic data.
 */

import { describe, it, expect } from 'vitest';
import {
  adviseEviction,
  computeRiskScore,
  recommend,
  rentToIncome,
  ScreeningInputSchema,
  SCREENING_MODEL_VERSION,
  type ScreeningInput,
} from '../tenant-screening-risk-model.js';

const BASE: ScreeningInput = {
  tenantId: 't-alpha',
  applicantId: 'a-1',
  rentHistoryScore: 800,
  altCreditScore: 750,
  proposedMonthlyRentCents: 50_000_00,
  employment: {
    monthsAtCurrent: 24,
    monthlyIncomeCents: 200_000_00,
    employerVerified: true,
  },
  evictionRecord: { evictionsLast5y: 0, arrearsSettled: false },
};

describe('rentToIncome', () => {
  it('returns proposed/income ratio', () => {
    expect(
      rentToIncome({ proposedMonthlyRentCents: 25_000, monthlyIncomeCents: 100_000 }),
    ).toBeCloseTo(0.25);
  });

  it('returns 1 when income is zero', () => {
    expect(
      rentToIncome({ proposedMonthlyRentCents: 10_000, monthlyIncomeCents: 0 }),
    ).toBe(1);
  });

  it('caps at 1 even when proposed > income', () => {
    expect(
      rentToIncome({ proposedMonthlyRentCents: 200, monthlyIncomeCents: 100 }),
    ).toBe(1);
  });
});

describe('computeRiskScore', () => {
  it('strong-signals candidate scores in excellent band', () => {
    const s = computeRiskScore(BASE);
    expect(s).toBeGreaterThanOrEqual(800);
  });

  it('weak-signals candidate scores in poor band', () => {
    const s = computeRiskScore({
      ...BASE,
      rentHistoryScore: 100,
      altCreditScore: 100,
      proposedMonthlyRentCents: 80_000_00,
      employment: {
        monthsAtCurrent: 1,
        monthlyIncomeCents: 100_000_00,
        employerVerified: false,
      },
      evictionRecord: { evictionsLast5y: 1, arrearsSettled: false },
    });
    expect(s).toBeLessThan(450);
  });

  it('eviction penalty subtracts up to 400 points', () => {
    const base = computeRiskScore(BASE);
    const withEviction = computeRiskScore({
      ...BASE,
      evictionRecord: { evictionsLast5y: 3, arrearsSettled: false },
    });
    expect(base - withEviction).toBeGreaterThanOrEqual(350);
  });

  it('arrears-settled offsets eviction penalty partially', () => {
    const noSettle = computeRiskScore({
      ...BASE,
      evictionRecord: { evictionsLast5y: 1, arrearsSettled: false },
    });
    const settled = computeRiskScore({
      ...BASE,
      evictionRecord: { evictionsLast5y: 1, arrearsSettled: true },
    });
    expect(settled).toBeGreaterThan(noSettle);
  });
});

describe('recommend', () => {
  it('strong candidate → accept', () => {
    const out = recommend(BASE);
    expect(out.recommendation).toBe('accept');
    expect(out.suggestedDepositMonths).toBe(1);
    expect(out.modelVersion).toBe(SCREENING_MODEL_VERSION);
  });

  it('hard-decline when rent > 50% income', () => {
    const out = recommend({
      ...BASE,
      proposedMonthlyRentCents: 60_000_00,
      employment: { ...BASE.employment, monthlyIncomeCents: 100_000_00 },
    });
    expect(out.recommendation).toBe('decline');
    expect(out.reasons.some((r) => r.includes('50%'))).toBe(true);
  });

  it('hard-decline when 2+ evictions in 5y', () => {
    const out = recommend({
      ...BASE,
      evictionRecord: { evictionsLast5y: 2, arrearsSettled: true },
    });
    expect(out.recommendation).toBe('decline');
    expect(out.reasons.some((r) => r.includes('evictions in 5y'))).toBe(true);
  });

  it('fair band → accept-with-deposit', () => {
    const out = recommend({
      ...BASE,
      rentHistoryScore: 500,
      altCreditScore: 450,
      proposedMonthlyRentCents: 70_000_00,
      employment: {
        monthsAtCurrent: 4,
        monthlyIncomeCents: 200_000_00,
        employerVerified: true,
      },
    });
    expect(['fair', 'good']).toContain(out.band);
    expect(['accept-with-deposit', 'accept']).toContain(out.recommendation);
  });

  it('1 prior eviction → uplift to accept-with-deposit', () => {
    const out = recommend({
      ...BASE,
      evictionRecord: { evictionsLast5y: 1, arrearsSettled: true },
    });
    expect(out.recommendation).toBe('accept-with-deposit');
    expect(out.suggestedDepositMonths).toBeGreaterThanOrEqual(2);
  });

  it('unverified employer → uplift to accept-with-deposit', () => {
    const out = recommend({
      ...BASE,
      employment: { ...BASE.employment, employerVerified: false },
    });
    expect(out.recommendation).toBe('accept-with-deposit');
  });

  it('rent-to-income between 40-50% triggers deposit uplift', () => {
    const out = recommend({
      ...BASE,
      proposedMonthlyRentCents: 90_000_00,
      employment: { ...BASE.employment, monthlyIncomeCents: 200_000_00 },
    });
    expect(out.recommendation).toBe('accept-with-deposit');
  });

  it('poor band → decline with reasons', () => {
    const out = recommend({
      ...BASE,
      rentHistoryScore: 100,
      altCreditScore: 100,
      employment: {
        monthsAtCurrent: 0,
        monthlyIncomeCents: 100_000_00,
        employerVerified: false,
      },
    });
    expect(out.recommendation).toBe('decline');
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it('rejects invalid input via schema', () => {
    expect(() =>
      recommend({ ...BASE, rentHistoryScore: 2000 }),
    ).toThrow(/invalid input/);
  });

  it('validates input schema directly', () => {
    expect(
      ScreeningInputSchema.safeParse({ ...BASE, altCreditScore: -1 }).success,
    ).toBe(false);
  });
});

describe('adviseEviction', () => {
  it('flags caution when strong screening accept → late-stage eviction', () => {
    const out = adviseEviction({
      screeningRecommendation: 'accept',
      screeningRiskScore: 820,
      evictionStage: 'writ-requested',
    });
    expect(out.cautionFlag).toBe(true);
    expect(out.reason).toContain('model drift');
  });

  it('does not flag at pre-notice stage even for strong screening', () => {
    const out = adviseEviction({
      screeningRecommendation: 'accept',
      screeningRiskScore: 820,
      evictionStage: 'pre-notice',
    });
    expect(out.cautionFlag).toBe(false);
  });

  it('does not flag when screening was decline', () => {
    const out = adviseEviction({
      screeningRecommendation: 'decline',
      screeningRiskScore: 300,
      evictionStage: 'writ-requested',
    });
    expect(out.cautionFlag).toBe(false);
    expect(out.reason).toContain('consistent with the original');
  });

  it('does not flag when score is below the strong threshold', () => {
    const out = adviseEviction({
      screeningRecommendation: 'accept',
      screeningRiskScore: 700,
      evictionStage: 'writ-requested',
    });
    expect(out.cautionFlag).toBe(false);
  });
});
