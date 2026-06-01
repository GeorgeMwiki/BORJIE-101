/**
 * Tests for the counterparty risk model. Pure deterministic
 * transform — fully testable from synthetic data.
 */

import { describe, it, expect } from 'vitest';
import {
  adviseSuspension,
  computeRiskScore,
  recommend,
  paymentToIncome,
  ScreeningInputSchema,
  SCREENING_MODEL_VERSION,
  type ScreeningInput,
} from '../counterparty-risk-model.js';

const BASE: ScreeningInput = {
  tenantId: 't-alpha',
  applicantId: 'a-1',
  creditHistoryScore: 800,
  altCreditScore: 750,
  proposedMonthlyPaymentCents: 50_000_00,
  employment: {
    monthsAtCurrent: 24,
    monthlyIncomeCents: 200_000_00,
    employerVerified: true,
  },
  suspensionRecord: { suspensionsLast5y: 0, outstandingSettled: false },
};

describe('paymentToIncome', () => {
  it('returns proposed/income ratio', () => {
    expect(
      paymentToIncome({ proposedMonthlyPaymentCents: 25_000, monthlyIncomeCents: 100_000 }),
    ).toBeCloseTo(0.25);
  });

  it('returns 1 when income is zero', () => {
    expect(
      paymentToIncome({ proposedMonthlyPaymentCents: 10_000, monthlyIncomeCents: 0 }),
    ).toBe(1);
  });

  it('caps at 1 even when proposed > income', () => {
    expect(
      paymentToIncome({ proposedMonthlyPaymentCents: 200, monthlyIncomeCents: 100 }),
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
      creditHistoryScore: 100,
      altCreditScore: 100,
      proposedMonthlyPaymentCents: 80_000_00,
      employment: {
        monthsAtCurrent: 1,
        monthlyIncomeCents: 100_000_00,
        employerVerified: false,
      },
      suspensionRecord: { suspensionsLast5y: 1, outstandingSettled: false },
    });
    expect(s).toBeLessThan(450);
  });

  it('suspension penalty subtracts up to 400 points', () => {
    const base = computeRiskScore(BASE);
    const withSuspension = computeRiskScore({
      ...BASE,
      suspensionRecord: { suspensionsLast5y: 3, outstandingSettled: false },
    });
    expect(base - withSuspension).toBeGreaterThanOrEqual(350);
  });

  it('outstanding-settled offsets suspension penalty partially', () => {
    const noSettle = computeRiskScore({
      ...BASE,
      suspensionRecord: { suspensionsLast5y: 1, outstandingSettled: false },
    });
    const settled = computeRiskScore({
      ...BASE,
      suspensionRecord: { suspensionsLast5y: 1, outstandingSettled: true },
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

  it('hard-decline when payment > 50% income', () => {
    const out = recommend({
      ...BASE,
      proposedMonthlyPaymentCents: 60_000_00,
      employment: { ...BASE.employment, monthlyIncomeCents: 100_000_00 },
    });
    expect(out.recommendation).toBe('decline');
    expect(out.reasons.some((r) => r.includes('50%'))).toBe(true);
  });

  it('hard-decline when 2+ suspensions in 5y', () => {
    const out = recommend({
      ...BASE,
      suspensionRecord: { suspensionsLast5y: 2, outstandingSettled: true },
    });
    expect(out.recommendation).toBe('decline');
    expect(out.reasons.some((r) => r.includes('suspensions in 5y'))).toBe(true);
  });

  it('fair band → accept-with-deposit', () => {
    const out = recommend({
      ...BASE,
      creditHistoryScore: 500,
      altCreditScore: 450,
      proposedMonthlyPaymentCents: 70_000_00,
      employment: {
        monthsAtCurrent: 4,
        monthlyIncomeCents: 200_000_00,
        employerVerified: true,
      },
    });
    expect(['fair', 'good']).toContain(out.band);
    expect(['accept-with-deposit', 'accept']).toContain(out.recommendation);
  });

  it('1 prior suspension → uplift to accept-with-deposit', () => {
    const out = recommend({
      ...BASE,
      suspensionRecord: { suspensionsLast5y: 1, outstandingSettled: true },
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

  it('payment-to-income between 40-50% triggers deposit uplift', () => {
    const out = recommend({
      ...BASE,
      proposedMonthlyPaymentCents: 90_000_00,
      employment: { ...BASE.employment, monthlyIncomeCents: 200_000_00 },
    });
    expect(out.recommendation).toBe('accept-with-deposit');
  });

  it('poor band → decline with reasons', () => {
    const out = recommend({
      ...BASE,
      creditHistoryScore: 100,
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
      recommend({ ...BASE, creditHistoryScore: 2000 }),
    ).toThrow(/invalid input/);
  });

  it('validates input schema directly', () => {
    expect(
      ScreeningInputSchema.safeParse({ ...BASE, altCreditScore: -1 }).success,
    ).toBe(false);
  });
});

describe('adviseSuspension', () => {
  it('flags caution when strong screening accept → late-stage suspension', () => {
    const out = adviseSuspension({
      screeningRecommendation: 'accept',
      screeningRiskScore: 820,
      suspensionStage: 'escalation-initiated',
    });
    expect(out.cautionFlag).toBe(true);
    expect(out.reason).toContain('model drift');
  });

  it('does not flag at pre-action stage even for strong screening', () => {
    const out = adviseSuspension({
      screeningRecommendation: 'accept',
      screeningRiskScore: 820,
      suspensionStage: 'pre-action',
    });
    expect(out.cautionFlag).toBe(false);
  });

  it('does not flag when screening was decline', () => {
    const out = adviseSuspension({
      screeningRecommendation: 'decline',
      screeningRiskScore: 300,
      suspensionStage: 'escalation-initiated',
    });
    expect(out.cautionFlag).toBe(false);
    expect(out.reason).toContain('consistent with the original');
  });

  it('does not flag when score is below the strong threshold', () => {
    const out = adviseSuspension({
      screeningRecommendation: 'accept',
      screeningRiskScore: 700,
      suspensionStage: 'escalation-initiated',
    });
    expect(out.cautionFlag).toBe(false);
  });
});
