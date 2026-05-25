/**
 * Unit tests for deterministic Payment Risk Calculator.
 *
 * Key invariants:
 *   - Weights sum to 1.0
 *   - All sub-scores clamped to [0, 100]
 *   - Monotonicity: strictly-better input => >= score (never decreases)
 *   - Level mapping matches the documented thresholds
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePaymentRisk,
  levelFromScore,
  PAYMENT_RISK_WEIGHTS,
  scoreArrears,
  scoreEmployment,
  scoreHistory,
  scoreIncome,
  scoreLitigation,
  type PaymentRiskInput,
} from '../payment-risk-calculator.js';

const baseInput: PaymentRiskInput = {
  history: {
    totalOnTime: 10,
    totalLate: 2,
    totalMissed: 0,
    averageDaysLate: 2,
  },
  income: { monthlyNetIncome: 5000, monthlyRent: 2000 },
  employment: { status: 'employed', monthsAtEmployer: 24, verified: true },
  arrears: { currentBalance: 0, monthlyRent: 2000 },
  litigation: { evictions: 0, judgments: 0, activeLawsuits: 0 },
};

describe('PAYMENT_RISK_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum = Object.values(PAYMENT_RISK_WEIGHTS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe('sub-scores', () => {
  it('all clamp to [0, 100]', () => {
    const extremes: PaymentRiskInput = {
      history: {
        totalOnTime: 0,
        totalLate: 0,
        totalMissed: 100,
        averageDaysLate: 90,
      },
      income: { monthlyNetIncome: 0, monthlyRent: 5000 },
      employment: {
        status: 'unemployed',
        monthsAtEmployer: 0,
        verified: false,
      },
      arrears: { currentBalance: 50000, monthlyRent: 1000 },
      litigation: { evictions: 10, judgments: 10, activeLawsuits: 10 },
    };
    expect(scoreHistory(extremes.history)).toBeGreaterThanOrEqual(0);
    expect(scoreHistory(extremes.history)).toBeLessThanOrEqual(100);
    expect(scoreIncome(extremes.income)).toBeGreaterThanOrEqual(0);
    expect(scoreEmployment(extremes.employment)).toBeGreaterThanOrEqual(0);
    expect(scoreArrears(extremes.arrears)).toBeGreaterThanOrEqual(0);
    expect(scoreLitigation(extremes.litigation)).toBeGreaterThanOrEqual(0);
  });
});

describe('levelFromScore', () => {
  it('maps thresholds correctly', () => {
    expect(levelFromScore(90)).toBe('LOW');
    expect(levelFromScore(75)).toBe('LOW');
    expect(levelFromScore(74)).toBe('MODERATE');
    expect(levelFromScore(60)).toBe('MODERATE');
    expect(levelFromScore(59)).toBe('ELEVATED');
    expect(levelFromScore(40)).toBe('ELEVATED');
    expect(levelFromScore(39)).toBe('HIGH');
    expect(levelFromScore(25)).toBe('HIGH');
    expect(levelFromScore(24)).toBe('CRITICAL');
    expect(levelFromScore(0)).toBe('CRITICAL');
  });
});

describe('calculatePaymentRisk — monotonicity', () => {
  it('improving history does not decrease score', () => {
    const worse = calculatePaymentRisk({
      ...baseInput,
      history: {
        totalOnTime: 5,
        totalLate: 5,
        totalMissed: 2,
        averageDaysLate: 10,
      },
    });
    const better = calculatePaymentRisk({
      ...baseInput,
      history: {
        totalOnTime: 12,
        totalLate: 0,
        totalMissed: 0,
        averageDaysLate: 0,
      },
    });
    expect(better.score).toBeGreaterThanOrEqual(worse.score);
  });

  it('higher income vs rent does not decrease score', () => {
    const worse = calculatePaymentRisk({
      ...baseInput,
      income: { monthlyNetIncome: 2100, monthlyRent: 2000 },
    });
    const better = calculatePaymentRisk({
      ...baseInput,
      income: { monthlyNetIncome: 8000, monthlyRent: 2000 },
    });
    expect(better.score).toBeGreaterThanOrEqual(worse.score);
  });

  it('less arrears does not decrease score', () => {
    const worse = calculatePaymentRisk({
      ...baseInput,
      arrears: { currentBalance: 4000, monthlyRent: 2000 },
    });
    const better = calculatePaymentRisk({
      ...baseInput,
      arrears: { currentBalance: 0, monthlyRent: 2000 },
    });
    expect(better.score).toBeGreaterThanOrEqual(worse.score);
  });

  it('fewer litigation events does not decrease score', () => {
    const worse = calculatePaymentRisk({
      ...baseInput,
      litigation: { evictions: 1, judgments: 1, activeLawsuits: 0 },
    });
    const better = calculatePaymentRisk({
      ...baseInput,
      litigation: { evictions: 0, judgments: 0, activeLawsuits: 0 },
    });
    expect(better.score).toBeGreaterThanOrEqual(worse.score);
  });
});

describe('calculatePaymentRisk — reproducibility', () => {
  it('same input yields same output', () => {
    const a = calculatePaymentRisk(baseInput);
    const b = calculatePaymentRisk(baseInput);
    expect(a).toEqual(b);
  });
});
