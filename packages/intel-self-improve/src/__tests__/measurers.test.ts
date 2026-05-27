/**
 * Tests for the three measurers (forecast / anomaly / recommendation).
 * Deterministic fixtures only — no random sampling.
 */

import { describe, expect, it } from 'vitest';
import {
  measureAnomalies,
  measureForecasts,
  measureRecommendations,
} from '../index.js';

describe('measureForecasts (interval coverage)', () => {
  it('computes empirical coverage rates and aggregate competence', () => {
    // 10 fixtures: 8 inside 80%, 10 inside 95%.
    const insideFixture = {
      observedValue: 100,
      interval80: { lower: 90, upper: 110 },
      interval95: { lower: 80, upper: 120 },
      userFollowthrough: 'accepted' as const,
    };
    const outsideFixture = {
      observedValue: 115,
      interval80: { lower: 90, upper: 110 },
      interval95: { lower: 80, upper: 120 },
      userFollowthrough: 'rejected' as const,
    };
    const cohort = [
      insideFixture,
      insideFixture,
      insideFixture,
      insideFixture,
      insideFixture,
      insideFixture,
      insideFixture,
      insideFixture,
      outsideFixture,
      outsideFixture,
    ];
    const result = measureForecasts(cohort);
    expect(result.nObservations).toBe(10);
    expect(result.empirical80).toBeCloseTo(0.8, 5);
    expect(result.empirical95).toBeCloseTo(1.0, 5);
    expect(result.competenceRate).toBeCloseTo(0.9, 5);
    // |0.8 - 0.8| + |1.0 - 0.95| = 0.05
    expect(result.calibrationError).toBeCloseTo(0.05, 5);
    expect(result.utilityRate).toBeCloseTo(0.8, 5);
  });

  it('rejects an empty cohort', () => {
    expect(() => measureForecasts([])).toThrow(RangeError);
  });
});

describe('measureAnomalies (precision + recall)', () => {
  it('computes F1 = 0.8 for TP=8 FP=2 FN=2', () => {
    const obs = Array.from({ length: 10 }, (_, i) => ({
      truePositive: i < 8,
      falsePositive: i >= 8,
      falseNegative: i >= 8,
      claimedFalsePositiveRate: 0.05,
      observedFalsePositive: i >= 8,
      userFollowthrough: 'accepted' as const,
    }));
    const result = measureAnomalies(obs);
    expect(result.precision).toBeCloseTo(8 / (8 + 2), 5);
    expect(result.recall).toBeCloseTo(8 / (8 + 2), 5);
    expect(result.f1).toBeCloseTo(0.8, 5);
    expect(result.competenceRate).toBeCloseTo(0.8, 5);
    // empirical FPR = 2/10 = 0.2; claimed = 0.05; calibration error = 0.15.
    expect(result.calibrationError).toBeCloseTo(0.15, 5);
    expect(result.utilityRate).toBe(1);
  });

  it('returns zero competence when no TPs are observed', () => {
    const obs = Array.from({ length: 4 }, () => ({
      truePositive: false,
      falsePositive: true,
      falseNegative: true,
      claimedFalsePositiveRate: 0.1,
      observedFalsePositive: true,
      userFollowthrough: 'rejected' as const,
    }));
    const result = measureAnomalies(obs);
    expect(result.competenceRate).toBe(0);
    expect(result.utilityRate).toBe(0);
  });
});

describe('measureRecommendations (top-K hit rate)', () => {
  it('computes hit rate against a deterministic click stream', () => {
    const obs = [
      {
        topK: ['a', 'b', 'c'],
        clickedItemIds: ['b'],
        predictedScoresByItemId: { a: 0.8, b: 0.6, c: 0.4 },
        userFollowthrough: 'accepted' as const,
      },
      {
        topK: ['x', 'y', 'z'],
        clickedItemIds: [],
        predictedScoresByItemId: { x: 0.9, y: 0.7, z: 0.5 },
        userFollowthrough: 'rejected' as const,
      },
      {
        topK: ['m', 'n'],
        clickedItemIds: ['m'],
        predictedScoresByItemId: { m: 0.5, n: 0.3 },
        userFollowthrough: 'modified' as const,
      },
    ];
    const result = measureRecommendations(obs);
    expect(result.hitCount).toBe(2);
    expect(result.competenceRate).toBeCloseTo(2 / 3, 5);
    // calibration: ECE depends on bucket distribution; just verify it's a
    // valid [0, 1] number.
    expect(result.calibrationError).toBeGreaterThanOrEqual(0);
    expect(result.calibrationError).toBeLessThanOrEqual(1);
    // utility = 2/3 (accepted + modified).
    expect(result.utilityRate).toBeCloseTo(2 / 3, 5);
  });
});
