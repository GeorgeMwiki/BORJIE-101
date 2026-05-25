/**
 * Tests for rent-credit-building/rent-savings-advisor.
 *
 * Coverage: nudge gating (score AND streak), tier percentages,
 * non-eligible message, currency pass-through, integer amount.
 */

import { describe, it, expect } from 'vitest';
import { computeSavingsNudge } from '../rent-savings-advisor.js';
import type { RentCreditScore } from '../types.js';
import {
  matchPartners,
  DEFAULT_PARTNERS,
} from '../financing-partnerships.js';
import { generateScoreReport } from '../score-report-generator.js';

function score(
  overrides: Partial<RentCreditScore> = {},
): RentCreditScore {
  return {
    userId: 'u1',
    tenantId: 't1',
    score: 80,
    grade: 'A',
    onTimeRatePct: 95,
    averageDaysLate: 1,
    totalPaymentsEvaluated: 12,
    consecutiveOnTimeStreak: 5,
    monthsObserved: 12,
    calculatedAt: '2026-04-01T00:00:00.000Z',
    recommendations: ['Keep going.'],
    ...overrides,
  };
}

describe('computeSavingsNudge', () => {
  it('returns shouldNudge=false when score < 70', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 65, consecutiveOnTimeStreak: 6 }),
      monthlyRent: 100_000,
      currency: 'KES',
    });
    expect(nudge.shouldNudge).toBe(false);
    expect(nudge.suggestedMonthlySavingsAmount).toBe(0);
    expect(nudge.messageEn).toMatch(/streak/);
  });

  it('returns shouldNudge=false when streak < 3', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 95, consecutiveOnTimeStreak: 2 }),
      monthlyRent: 100_000,
      currency: 'KES',
    });
    expect(nudge.shouldNudge).toBe(false);
  });

  it('suggests 5% at score 70', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 70, consecutiveOnTimeStreak: 3 }),
      monthlyRent: 100_000,
      currency: 'KES',
    });
    expect(nudge.shouldNudge).toBe(true);
    expect(nudge.suggestedMonthlySavingsPct).toBe(5);
    expect(nudge.suggestedMonthlySavingsAmount).toBe(5000);
  });

  it('suggests 7% at score 80', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 80, consecutiveOnTimeStreak: 3 }),
      monthlyRent: 100_000,
      currency: 'KES',
    });
    expect(nudge.suggestedMonthlySavingsPct).toBe(7);
    expect(nudge.suggestedMonthlySavingsAmount).toBe(7000);
  });

  it('suggests 10% at score 90', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 92, consecutiveOnTimeStreak: 6 }),
      monthlyRent: 100_000,
      currency: 'TZS',
    });
    expect(nudge.suggestedMonthlySavingsPct).toBe(10);
    expect(nudge.suggestedMonthlySavingsAmount).toBe(10000);
    expect(nudge.currency).toBe('TZS');
  });

  it('rounds savings amount to an integer', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 92, consecutiveOnTimeStreak: 6 }),
      monthlyRent: 12345,
      currency: 'KES',
    });
    expect(Number.isInteger(nudge.suggestedMonthlySavingsAmount)).toBe(true);
  });

  it('produces both English and Swahili messages', () => {
    const nudge = computeSavingsNudge({
      score: score({ score: 95, consecutiveOnTimeStreak: 6 }),
      monthlyRent: 100_000,
      currency: 'KES',
    });
    expect(nudge.messageEn.length).toBeGreaterThan(0);
    expect(nudge.messageSw.length).toBeGreaterThan(0);
  });
});

describe('matchPartners', () => {
  it('marks the tenant eligible only when score meets minimum', () => {
    const matches = matchPartners(score({ score: 50 }), {
      tenantCountry: 'TZA',
    });
    const litfin = matches.find((m) => m.partner.id === 'litfin-micro-loan');
    expect(litfin?.eligible).toBe(false);
  });

  it('marks tenant eligible at exactly the minimum score', () => {
    const matches = matchPartners(score({ score: 70 }), {
      tenantCountry: 'TZA',
    });
    const litfin = matches.find((m) => m.partner.id === 'litfin-micro-loan');
    expect(litfin?.eligible).toBe(true);
  });

  it('filters by tenant country', () => {
    const matches = matchPartners(score({ score: 80 }), {
      tenantCountry: 'KEN',
    });
    expect(
      matches.every(
        (m) => m.partner.country === 'KEN' || m.partner.country === 'ANY',
      ),
    ).toBe(true);
  });

  it('respects allowedPartnerIds', () => {
    const matches = matchPartners(score({ score: 95 }), {
      tenantCountry: 'TZA',
      allowedPartnerIds: ['borjie-savings-basic'],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].partner.id).toBe('borjie-savings-basic');
  });

  it('uses DEFAULT_PARTNERS when no list is provided', () => {
    const matches = matchPartners(score({ score: 95 }), {
      tenantCountry: 'TZA',
    });
    expect(matches.length).toBe(
      DEFAULT_PARTNERS.filter(
        (p) => p.country === 'TZA' || p.country === 'ANY',
      ).length,
    );
  });

  it('emits both EN and SW reasons', () => {
    const [first] = matchPartners(score({ score: 95 }), {
      tenantCountry: 'TZA',
    });
    expect(first.reasonEn.length).toBeGreaterThan(0);
    expect(first.reasonSw.length).toBeGreaterThan(0);
  });
});

describe('generateScoreReport', () => {
  it('produces stable, identifiable reportId per (user, tenant, time)', () => {
    const r = generateScoreReport(score(), '2026-04-01T00:00:00.000Z');
    expect(r.reportId).toMatch(/^rcr-t1-u1-/);
    expect(r.userId).toBe('u1');
    expect(r.tenantId).toBe('t1');
  });

  it('includes recommendations text inside the narrative', () => {
    const r = generateScoreReport(
      score({ recommendations: ['Important advice.'] }),
      '2026-04-01T00:00:00.000Z',
    );
    expect(r.narrativeEn).toContain('Important advice.');
    expect(r.narrativeSw).toContain('Important advice.');
  });

  it('mentions a long streak when streak >= 6', () => {
    const r = generateScoreReport(
      score({ consecutiveOnTimeStreak: 8 }),
      '2026-04-01T00:00:00.000Z',
    );
    expect(r.narrativeEn).toMatch(/strong signal/i);
  });

  it('omits the streak phrase when streak < 3', () => {
    const r = generateScoreReport(
      score({ consecutiveOnTimeStreak: 1 }),
      '2026-04-01T00:00:00.000Z',
    );
    expect(r.narrativeEn).not.toMatch(/streak/i);
  });

  it('describes "near due date" when avg lateness <= 2', () => {
    const r = generateScoreReport(
      score({ averageDaysLate: 1 }),
      '2026-04-01T00:00:00.000Z',
    );
    expect(r.narrativeEn).toMatch(/on or near the due date/);
  });
});
