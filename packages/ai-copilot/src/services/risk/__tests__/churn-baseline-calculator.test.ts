/**
 * Unit tests for deterministic Churn Baseline Calculator.
 *
 * Note: higher score => higher churn risk (opposite direction from
 * payment-risk). Monotonicity: worse signals => non-decreasing score.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateChurnBaseline,
  CHURN_WEIGHTS,
  churnLevelFromScore,
  type ChurnBaselineInput,
} from '../churn-baseline-calculator.js';

const baseInput: ChurnBaselineInput = {
  lateness: {
    onTimePayments: 10,
    latePayments: 0,
    missedPayments: 0,
    averageDaysLate: 0,
  },
  complaints: {
    complaintsCount: 0,
    inquiriesCount: 1,
    sentimentTrend: 'positive',
  },
  maintenance: {
    totalRequests: 2,
    openRequests: 0,
    averageResolutionDays: 2,
    satisfactionRating: 5,
  },
  recency: {
    daysUntilLeaseEnd: 180,
    previousRenewals: 1,
    declinedOffers: 0,
  },
  market: {
    areaRentTrend: 'stable',
    competitorAvailability: 'low',
    marketRentComparison: 0.95,
  },
};

describe('CHURN_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum = Object.values(CHURN_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe('churnLevelFromScore', () => {
  it('maps thresholds correctly', () => {
    expect(churnLevelFromScore(90)).toBe('VERY_HIGH');
    expect(churnLevelFromScore(75)).toBe('VERY_HIGH');
    expect(churnLevelFromScore(60)).toBe('HIGH');
    expect(churnLevelFromScore(40)).toBe('MEDIUM');
    expect(churnLevelFromScore(25)).toBe('LOW');
    expect(churnLevelFromScore(10)).toBe('VERY_LOW');
  });
});

describe('calculateChurnBaseline — monotonicity', () => {
  it('more lateness does not decrease churn score', () => {
    const better = calculateChurnBaseline(baseInput);
    const worse = calculateChurnBaseline({
      ...baseInput,
      lateness: {
        onTimePayments: 3,
        latePayments: 5,
        missedPayments: 2,
        averageDaysLate: 15,
      },
    });
    expect(worse.score).toBeGreaterThanOrEqual(better.score);
  });

  it('more complaints + declining sentiment raises churn score', () => {
    const better = calculateChurnBaseline(baseInput);
    const worse = calculateChurnBaseline({
      ...baseInput,
      complaints: {
        complaintsCount: 5,
        inquiriesCount: 2,
        sentimentTrend: 'declining',
      },
    });
    expect(worse.score).toBeGreaterThanOrEqual(better.score);
  });

  it('closer to lease end + declined offers raises churn score', () => {
    const better = calculateChurnBaseline(baseInput);
    const worse = calculateChurnBaseline({
      ...baseInput,
      recency: {
        daysUntilLeaseEnd: 15,
        previousRenewals: 0,
        declinedOffers: 2,
      },
    });
    expect(worse.score).toBeGreaterThanOrEqual(better.score);
  });

  it('market rent higher than current raises churn score', () => {
    const better = calculateChurnBaseline(baseInput);
    const worse = calculateChurnBaseline({
      ...baseInput,
      market: {
        areaRentTrend: 'decreasing',
        competitorAvailability: 'high',
        marketRentComparison: 1.2,
      },
    });
    expect(worse.score).toBeGreaterThanOrEqual(better.score);
  });
});

describe('calculateChurnBaseline — reproducibility', () => {
  it('same input yields same output', () => {
    const a = calculateChurnBaseline(baseInput);
    const b = calculateChurnBaseline(baseInput);
    expect(a).toEqual(b);
  });

  it('all sub-scores in [0, 100]', () => {
    const result = calculateChurnBaseline(baseInput);
    for (const v of Object.values(result.subScores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
