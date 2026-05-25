/**
 * Tests for rent-credit-building/rent-credit-score.
 *
 * Coverage: empty input → 0/F, perfect record → top tier, lateness penalty,
 * partial-payment exclusion, on-time streak, recommendations bands,
 * grade boundaries, months-observed unique counting.
 */

import { describe, it, expect } from 'vitest';
import { calculateRentCreditScore } from '../rent-credit-score.js';
import type { PaymentRecord } from '../types.js';

function payment(
  i: number,
  daysOffset: number,
  paid: boolean = true,
  partial: number = 1,
): PaymentRecord {
  const due = new Date(2026, 0 + i, 1);
  const paidDate = new Date(due);
  paidDate.setDate(due.getDate() + daysOffset);
  return {
    tenantId: 't1',
    leaseId: 'lease-1',
    userId: 'u1',
    dueDate: due.toISOString(),
    paidAt: paid ? paidDate.toISOString() : undefined,
    amountExpected: 1000,
    amountPaid: paid ? Math.round(1000 * partial) : 0,
    currency: 'KES',
    method: 'mpesa',
  };
}

describe('calculateRentCreditScore', () => {
  it('returns score 0 grade F for an empty history', () => {
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records: [],
      now: new Date('2026-04-01').toISOString(),
    });
    expect(score.score).toBe(0);
    expect(score.grade).toBe('F');
    expect(score.totalPaymentsEvaluated).toBe(0);
    expect(score.consecutiveOnTimeStreak).toBe(0);
  });

  it('awards a top grade for a perfect 12-month on-time record', () => {
    const records: PaymentRecord[] = Array.from({ length: 12 }, (_, i) =>
      payment(i, 0),
    );
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2027-01-01').toISOString(),
    });
    expect(score.onTimeRatePct).toBe(100);
    expect(['A+', 'A']).toContain(score.grade);
    expect(score.consecutiveOnTimeStreak).toBe(12);
    expect(score.monthsObserved).toBe(12);
  });

  it('penalises persistent lateness', () => {
    const records: PaymentRecord[] = Array.from({ length: 12 }, (_, i) =>
      payment(i, 15),
    );
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2027-01-01').toISOString(),
    });
    expect(score.onTimeRatePct).toBe(0);
    expect(score.averageDaysLate).toBeCloseTo(15);
    expect(score.score).toBeLessThan(40);
    expect(score.grade).toBe('F');
  });

  it('excludes records with partial payment <95% from the late-day average', () => {
    const records: PaymentRecord[] = [
      payment(0, 0, true, 0.5),
      payment(1, 0, true, 1),
      payment(2, 0, true, 1),
    ];
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-04-01').toISOString(),
    });
    // 2 out of 3 records are eligible (full pay); both on time → onTimeRate = 2/3
    expect(score.totalPaymentsEvaluated).toBe(3);
    expect(score.onTimeRatePct).toBeCloseTo((2 / 3) * 100, 1);
  });

  it('counts the consecutive on-time streak from the most recent record back', () => {
    const records: PaymentRecord[] = [
      payment(0, 10), // jan: late
      payment(1, 0), // feb: on-time
      payment(2, 0), // mar: on-time
      payment(3, 1), // apr: on-time (≤2)
    ];
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-05-01').toISOString(),
    });
    expect(score.consecutiveOnTimeStreak).toBe(3);
  });

  it('caps streak at the most recent break in the chain', () => {
    const records: PaymentRecord[] = [
      payment(0, 0),
      payment(1, 0),
      payment(2, 5), // break at most-recent
    ];
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-04-01').toISOString(),
    });
    expect(score.consecutiveOnTimeStreak).toBe(0);
  });

  it('emits an "Excellent track record" recommendation at >=95% on-time', () => {
    const records = Array.from({ length: 20 }, (_, i) => payment(i, 0));
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2027-09-01').toISOString(),
    });
    expect(
      score.recommendations.some((r) => /Excellent/i.test(r)),
    ).toBe(true);
  });

  it('warns about insufficient history when monthsObserved < 6', () => {
    const records = Array.from({ length: 3 }, (_, i) => payment(i, 0));
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-04-01').toISOString(),
    });
    expect(
      score.recommendations.some((r) => /Insufficient history/i.test(r)),
    ).toBe(true);
  });

  it('rounds score and rate to one decimal place', () => {
    const records = [payment(0, 0)];
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-04-01').toISOString(),
    });
    // Float dance shouldn't introduce >1 decimal precision
    expect(score.score.toString()).not.toMatch(/\.\d{2,}/);
    expect(score.onTimeRatePct.toString()).not.toMatch(/\.\d{2,}/);
  });

  it('treats unpaid records as 999 days late but excludes them from paid-only mean', () => {
    const records: PaymentRecord[] = [
      payment(0, 0),
      payment(1, 0),
      payment(2, 0, false),
    ];
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records,
      now: new Date('2026-04-01').toISOString(),
    });
    expect(score.totalPaymentsEvaluated).toBe(3);
    // Two paid records were on-time, divided across 3 totals → 2/3 ~ 66.7%
    expect(score.onTimeRatePct).toBeCloseTo((2 / 3) * 100, 1);
  });

  it('counts unique calendar months only', () => {
    // Two payments in same January, then one in February.
    const sameMonth1: PaymentRecord = {
      ...payment(0, 0),
      dueDate: new Date(2026, 0, 5).toISOString(),
    };
    const sameMonth2: PaymentRecord = {
      ...payment(0, 0),
      dueDate: new Date(2026, 0, 28).toISOString(),
    };
    const nextMonth: PaymentRecord = {
      ...payment(0, 0),
      dueDate: new Date(2026, 1, 1).toISOString(),
    };
    const score = calculateRentCreditScore({
      userId: 'u1',
      tenantId: 't1',
      records: [sameMonth1, sameMonth2, nextMonth],
      now: new Date('2026-04-01').toISOString(),
    });
    expect(score.monthsObserved).toBe(2);
  });
});
