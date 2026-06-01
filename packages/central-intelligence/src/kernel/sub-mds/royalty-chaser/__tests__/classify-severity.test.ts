import { describe, expect, it } from 'vitest';
import {
  classifySeverity,
  type ArrearsSeverity,
  type ClassifySeverityArgs,
} from '../tools/classify-severity.js';

interface Case {
  readonly args: ClassifySeverityArgs;
  readonly expectedSeverity: ArrearsSeverity;
  readonly expectedAction?: string;
  readonly note?: string;
}

const RENT = 50000_00; // 50,000 minor units (i.e. 50 in major)

const CASES: ReadonlyArray<Case> = [
  // MILD — 1-7d
  { args: { daysOverdue: 1, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild', expectedAction: 'soft-reminder' },
  { args: { daysOverdue: 3, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 5, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 7, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 2, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'mild' },
  // MODERATE — 8-21d, first-delinquency
  { args: { daysOverdue: 8, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 12, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 15, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 18, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 21, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  // SERIOUS — 22-44d, first-delinquency
  { args: { daysOverdue: 22, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 30, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 35, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 40, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 44, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  // CRITICAL — 45d+
  { args: { daysOverdue: 45, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 60, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 90, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical', expectedAction: 'draft-notice-for-owner' },
  { args: { daysOverdue: 120, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical' },
  // Repeat history bumps one level
  { args: { daysOverdue: 5, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'repeat' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 12, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'repeat' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 25, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'repeat' }, expectedSeverity: 'critical' },
  // Chronic bumps two levels
  { args: { daysOverdue: 5, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'chronic' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 10, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'chronic' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 15, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'chronic' }, expectedSeverity: 'critical' },
  // Amount > 1.5x rent bumps one level
  { args: { daysOverdue: 5, amountMinor: RENT * 2, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 10, amountMinor: RENT * 2, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 25, amountMinor: RENT * 2, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical' },
  // Partial payment softens by one (mild stays mild)
  { args: { daysOverdue: 12, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency', partialPaymentSeen: true }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 25, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency', partialPaymentSeen: true }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 50, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency', partialPaymentSeen: true }, expectedSeverity: 'serious' },
  // Boundary edge cases
  { args: { daysOverdue: 0, amountMinor: 0, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 1, amountMinor: RENT, monthlyRentMinor: 0, tenantHistory: 'first-delinquency' }, expectedSeverity: 'mild' },
  // Combined history + amount
  { args: { daysOverdue: 3, amountMinor: RENT * 2, monthlyRentMinor: RENT, tenantHistory: 'repeat' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 6, amountMinor: RENT * 2, monthlyRentMinor: RENT, tenantHistory: 'chronic' }, expectedSeverity: 'critical' },
  // More mild
  { args: { daysOverdue: 4, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'mild' },
  { args: { daysOverdue: 6, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'mild' },
  // More moderate
  { args: { daysOverdue: 10, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 14, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 20, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'moderate' },
  // More serious
  { args: { daysOverdue: 25, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 33, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'serious' },
  // More critical
  { args: { daysOverdue: 50, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 75, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 100, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown' }, expectedSeverity: 'critical' },
  // Partial payment + chronic — chronic bump +2, partial -1 = net +1
  { args: { daysOverdue: 5, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'chronic', partialPaymentSeen: true }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 12, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'chronic', partialPaymentSeen: true }, expectedSeverity: 'serious' },
  // Mid-range first-delinquency
  { args: { daysOverdue: 11, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'moderate' },
  { args: { daysOverdue: 27, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'serious' },
  { args: { daysOverdue: 47, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' }, expectedSeverity: 'critical' },
  { args: { daysOverdue: 17, amountMinor: RENT * 3, monthlyRentMinor: RENT, tenantHistory: 'repeat' }, expectedSeverity: 'critical' },
];

describe('classifySeverity — accuracy harness', () => {
  it('produces correct severity on ≥85% of cases', () => {
    let hits = 0;
    const misses: Array<{ idx: number; expected: ArrearsSeverity; got: ArrearsSeverity }> = [];
    CASES.forEach((c, idx) => {
      const r = classifySeverity(c.args);
      if (r.severity === c.expectedSeverity) hits += 1;
      else misses.push({ idx, expected: c.expectedSeverity, got: r.severity });
    });
    const accuracy = hits / CASES.length;
    if (accuracy < 0.85) console.error('Severity misses:', misses);
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('never escalates beyond critical', () => {
    const r = classifySeverity({ daysOverdue: 365, amountMinor: 99999900, monthlyRentMinor: RENT, tenantHistory: 'chronic' });
    expect(r.severity).toBe('critical');
  });

  it('action mapping: mild → soft-reminder, critical → draft-notice', () => {
    const m = classifySeverity({ daysOverdue: 1, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' });
    expect(m.recommendedAction).toBe('soft-reminder');
    const c = classifySeverity({ daysOverdue: 60, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'first-delinquency' });
    expect(c.recommendedAction).toBe('draft-notice-for-owner');
  });

  it('payment-plan offer triggers on moderate + partial payment', () => {
    const r = classifySeverity({ daysOverdue: 10, amountMinor: RENT, monthlyRentMinor: RENT, tenantHistory: 'unknown', partialPaymentSeen: true });
    expect(r.recommendedAction).toBe('payment-plan-offer');
  });
});
