/**
 * Rent Credit Building tests.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRentCreditScore,
  generateScoreReport,
  matchPartners,
  computeSavingsNudge,
  DEFAULT_PARTNERS,
  type PaymentRecord,
} from '../rent-credit-building/index.js';

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    tenantId: overrides.tenantId ?? 't-1',
    leaseId: overrides.leaseId ?? 'lease-1',
    userId: overrides.userId ?? 'u-1',
    dueDate: overrides.dueDate ?? '2026-01-01T00:00:00Z',
    paidAt: overrides.paidAt ?? '2026-01-01T00:00:00Z',
    amountExpected: overrides.amountExpected ?? 500000,
    amountPaid: overrides.amountPaid ?? 500000,
    currency: overrides.currency ?? 'TZS',
    method: overrides.method ?? 'gepg',
  };
}

describe('Rent credit score', () => {
  it('perfect history yields A+', () => {
    const records: PaymentRecord[] = [];
    for (let i = 1; i <= 12; i++) {
      const month = String(i).padStart(2, '0');
      records.push(payment({ dueDate: `2026-${month}-01T00:00:00Z`, paidAt: `2026-${month}-01T00:00:00Z` }));
    }
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records,
      now: '2026-12-31T00:00:00Z',
    });
    expect(score.grade).toBe('A+');
    expect(score.onTimeRatePct).toBe(100);
  });

  it('late payments drop the score', () => {
    const records: PaymentRecord[] = [
      payment({ dueDate: '2026-01-01T00:00:00Z', paidAt: '2026-01-20T00:00:00Z' }),
      payment({ dueDate: '2026-02-01T00:00:00Z', paidAt: '2026-02-15T00:00:00Z' }),
    ];
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records,
      now: '2026-03-01T00:00:00Z',
    });
    expect(score.averageDaysLate).toBeGreaterThan(5);
    expect(score.grade).not.toBe('A+');
  });

  it('missing payments reduce score', () => {
    const records: PaymentRecord[] = [
      payment({ amountPaid: 0, paidAt: undefined }),
    ];
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records,
      now: '2026-02-01T00:00:00Z',
    });
    expect(score.score).toBeLessThan(50);
  });

  it('counts consecutive streak', () => {
    const records: PaymentRecord[] = [];
    for (let i = 1; i <= 6; i++) {
      const month = String(i).padStart(2, '0');
      records.push(payment({ dueDate: `2026-${month}-01T00:00:00Z`, paidAt: `2026-${month}-01T00:00:00Z` }));
    }
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records,
      now: '2026-07-01T00:00:00Z',
    });
    expect(score.consecutiveOnTimeStreak).toBe(6);
  });

  it('produces recommendations', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    expect(score.recommendations.length).toBeGreaterThan(0);
  });
});

describe('Score report generator', () => {
  it('produces English and Swahili narratives', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    const report = generateScoreReport(score, '2026-02-01T00:00:00Z');
    expect(report.narrativeEn).toContain('Rent credit score');
    expect(report.narrativeSw).toContain('Alama ya kodi');
  });

  it('generates a unique report id', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    const report = generateScoreReport(score, '2026-02-01T00:00:00Z');
    expect(report.reportId).toContain('t-1');
    expect(report.reportId).toContain('u-1');
  });
});

describe('Financing partnerships', () => {
  it('routes high scorers to deposit finance', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: Array.from({ length: 12 }, (_, i) => {
        const month = String(i + 1).padStart(2, '0');
        return payment({ dueDate: `2026-${month}-01T00:00:00Z`, paidAt: `2026-${month}-01T00:00:00Z` });
      }),
      now: '2026-12-31T00:00:00Z',
    });
    const matches = matchPartners(score, { tenantCountry: 'TZA' });
    const litfinDeposit = matches.find((m) => m.partner.id === 'litfin-deposit-finance');
    expect(litfinDeposit?.eligible).toBe(true);
  });

  it('refuses low scorers for strict partners', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment({ amountPaid: 0, paidAt: undefined })],
      now: '2026-02-01T00:00:00Z',
    });
    const matches = matchPartners(score, { tenantCountry: 'TZA' });
    const rto = matches.find((m) => m.partner.id === 'litfin-rent-to-own');
    expect(rto?.eligible).toBe(false);
  });

  it('respects country filter', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    const matches = matchPartners(score, { tenantCountry: 'KEN' });
    expect(matches.find((m) => m.partner.id.startsWith('litfin-'))).toBeUndefined();
  });

  it('ANY-country partners always visible', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    const matches = matchPartners(score, { tenantCountry: 'KEN' });
    expect(matches.find((m) => m.partner.productType === 'savings')).toBeDefined();
  });

  it('allowedPartnerIds filter restricts output', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment()],
      now: '2026-02-01T00:00:00Z',
    });
    const matches = matchPartners(score, {
      tenantCountry: 'TZA',
      allowedPartnerIds: ['litfin-micro-loan'],
    });
    expect(matches.length).toBe(1);
  });

  it('DEFAULT_PARTNERS includes 4 partners', () => {
    expect(DEFAULT_PARTNERS.length).toBe(4);
  });
});

describe('Rent savings advisor', () => {
  it('does not nudge for low scorer', () => {
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records: [payment({ amountPaid: 0, paidAt: undefined })],
      now: '2026-02-01T00:00:00Z',
    });
    const nudge = computeSavingsNudge({
      score,
      monthlyRent: 500000,
      currency: 'TZS',
    });
    expect(nudge.shouldNudge).toBe(false);
  });

  it('nudges high scorers', () => {
    const records: PaymentRecord[] = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0');
      return payment({ dueDate: `2026-${month}-01T00:00:00Z`, paidAt: `2026-${month}-01T00:00:00Z` });
    });
    const score = calculateRentCreditScore({
      userId: 'u-1',
      tenantId: 't-1',
      records,
      now: '2026-12-31T00:00:00Z',
    });
    const nudge = computeSavingsNudge({
      score,
      monthlyRent: 500000,
      currency: 'TZS',
    });
    expect(nudge.shouldNudge).toBe(true);
    expect(nudge.suggestedMonthlySavingsAmount).toBeGreaterThan(0);
  });
});
