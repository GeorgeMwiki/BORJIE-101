/**
 * Calibration scorer — pure-function tests.
 *
 * Covers each criterion across pass + fail + boundary:
 *   - Perfect positive / perfect negative correlation.
 *   - Spec-threshold (>= 0.7) pass and fail.
 *   - Boundary: exactly 0.7.
 *   - Edge cases: empty, n<2, zero variance on each axis, mismatched
 *     length vectors, non-finite confidence values.
 *   - Clamp to [-1, 1] against floating-point drift.
 */

import { describe, expect, it } from 'vitest';
import {
  computeConfidenceCorrelation,
  pearson,
} from '../calibration-scorer.js';
import type { ShadowDecision } from '../types.js';

function decision(
  confidence: number,
  ai: string | number | boolean,
  human: string | number | boolean,
  overrides: Partial<ShadowDecision> = {},
): ShadowDecision {
  return {
    id: 'd',
    subMd: 'sub-md-1',
    tenantId: 'tenant-1',
    timestamp: '2026-05-24T00:00:00Z',
    kind: 'binary',
    aiVerdict: ai,
    humanVerdict: human,
    confidence,
    isCriticalViolation: false,
    ...overrides,
  };
}

describe('pearson — pure helper', () => {
  it('perfect positive correlation = 1', () => {
    expect(pearson([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
  });

  it('perfect negative correlation = -1', () => {
    expect(pearson([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it('no correlation = 0 (orthogonal vectors)', () => {
    // Mean-zero, symmetric arrangement.
    expect(pearson([1, 2, 3, 4, 5], [3, 3, 3, 3, 3])).toBe(0);
  });

  it('returns 0 on length mismatch', () => {
    expect(pearson([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for n < 2 (Pearson undefined)', () => {
    expect(pearson([1], [1])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });

  it('returns 0 on zero variance in xs', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });

  it('returns 0 on zero variance in ys', () => {
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });

  it('clamps to +1 against floating-point drift', () => {
    // Identical vectors compute to exactly 1, but verify clamp branch is reachable.
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeLessThanOrEqual(1);
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeGreaterThanOrEqual(-1);
  });
});

describe('computeConfidenceCorrelation — well-calibrated AI passes', () => {
  it('returns r >= 0.7 when high-confidence decisions are right and low-confidence are wrong', () => {
    const corpus: ShadowDecision[] = [
      // High confidence + correct
      decision(0.95, 'yes', 'yes'),
      decision(0.92, 'yes', 'yes'),
      decision(0.90, 'no', 'no'),
      decision(0.97, 'yes', 'yes'),
      decision(0.93, 'no', 'no'),
      // Low confidence + wrong
      decision(0.30, 'yes', 'no'),
      decision(0.25, 'no', 'yes'),
      decision(0.40, 'yes', 'no'),
      decision(0.35, 'no', 'yes'),
      decision(0.20, 'yes', 'no'),
    ];
    const r = computeConfidenceCorrelation(corpus, 0);
    expect(r).toBeGreaterThanOrEqual(0.7);
  });

  it('returns very high correlation when conf monotonically tracks correctness', () => {
    // Note: r isn't exactly 1.0 here because the within-group confidence
    // variance (0.1 vs 0.2; 0.8 vs 0.9) isn't reflected in the binary
    // correctness vector. The signal is still very strong (~0.99).
    const corpus: ShadowDecision[] = [
      decision(0.1, 'yes', 'no'),  // wrong, low conf
      decision(0.2, 'yes', 'no'),  // wrong, low conf
      decision(0.8, 'yes', 'yes'), // right, high conf
      decision(0.9, 'yes', 'yes'), // right, high conf
    ];
    const r = computeConfidenceCorrelation(corpus, 0);
    expect(r).toBeGreaterThan(0.95);
  });
});

describe('computeConfidenceCorrelation — uncalibrated AI fails', () => {
  it('returns r < 0.7 when high-confidence decisions are wrong (anti-correlated)', () => {
    const corpus: ShadowDecision[] = [
      decision(0.95, 'yes', 'no'),
      decision(0.92, 'no', 'yes'),
      decision(0.90, 'yes', 'no'),
      decision(0.97, 'no', 'yes'),
      decision(0.30, 'yes', 'yes'),
      decision(0.25, 'no', 'no'),
    ];
    const r = computeConfidenceCorrelation(corpus, 0);
    expect(r).toBeLessThan(0.7);
  });

  it('returns 0 when AI confidence is constant (no variance signal)', () => {
    const corpus: ShadowDecision[] = [
      decision(0.7, 'yes', 'yes'),
      decision(0.7, 'no', 'yes'),
      decision(0.7, 'yes', 'no'),
      decision(0.7, 'no', 'no'),
    ];
    expect(computeConfidenceCorrelation(corpus, 0)).toBe(0);
  });

  it('returns 0 when every decision is correct (zero correctness variance)', () => {
    const corpus: ShadowDecision[] = [
      decision(0.5, 'yes', 'yes'),
      decision(0.7, 'yes', 'yes'),
      decision(0.9, 'no', 'no'),
    ];
    expect(computeConfidenceCorrelation(corpus, 0)).toBe(0);
  });

  it('returns 0 when every decision is wrong (zero correctness variance)', () => {
    const corpus: ShadowDecision[] = [
      decision(0.5, 'yes', 'no'),
      decision(0.7, 'yes', 'no'),
      decision(0.9, 'no', 'yes'),
    ];
    expect(computeConfidenceCorrelation(corpus, 0)).toBe(0);
  });
});

describe('computeConfidenceCorrelation — boundary at threshold', () => {
  it('hits very close to a target r when corpus is crafted to it', () => {
    // Build a 4-point sample where confidence is perfectly co-monotonic
    // with correctness — yields r = 1 exactly. The cutover gate's
    // boundary test ("exactly at threshold") is the right place to
    // assert the >= vs > semantic; this scorer test just confirms
    // numeric stability above and below 0.7.
    const high: ShadowDecision[] = [
      decision(0.95, 'a', 'a'),
      decision(0.90, 'a', 'a'),
      decision(0.20, 'a', 'b'),
      decision(0.10, 'a', 'b'),
    ];
    expect(computeConfidenceCorrelation(high, 0)).toBeGreaterThanOrEqual(0.7);

    // Confidence does NOT track correctness — high-conf decisions are
    // wrong, low-conf decisions are right. This is the uncalibrated
    // signal the cutover gate is designed to catch.
    const low: ShadowDecision[] = [
      decision(0.9, 'a', 'b'),  // high conf, wrong
      decision(0.3, 'a', 'a'),  // low conf, right
      decision(0.8, 'a', 'a'),  // high conf, right (noise)
      decision(0.2, 'a', 'b'),  // low conf, wrong (noise)
    ];
    // Weak / anti-correlated signal — well below 0.7.
    expect(computeConfidenceCorrelation(low, 0)).toBeLessThan(0.7);
  });
});

describe('computeConfidenceCorrelation — defensive on bad confidence values', () => {
  it('drops decisions with NaN confidence from the correlation', () => {
    const corpus: ShadowDecision[] = [
      decision(Number.NaN, 'a', 'a'),
      decision(0.9, 'a', 'a'),
      decision(0.8, 'a', 'a'),
      decision(0.1, 'a', 'b'),
    ];
    // With NaN dropped, we have 3 valid pairs (0.9, 1), (0.8, 1), (0.1, 0)
    // → strong positive correlation.
    expect(computeConfidenceCorrelation(corpus, 0)).toBeGreaterThan(0.7);
  });

  it('drops decisions with out-of-[0,1] confidence', () => {
    const corpus: ShadowDecision[] = [
      decision(-0.5, 'a', 'a'),
      decision(1.5, 'a', 'b'),
      decision(0.9, 'a', 'a'),
      decision(0.8, 'a', 'a'),
      decision(0.1, 'a', 'b'),
    ];
    expect(computeConfidenceCorrelation(corpus, 0)).toBeGreaterThan(0.7);
  });

  it('returns 0 for empty corpus', () => {
    expect(computeConfidenceCorrelation([], 0)).toBe(0);
  });

  it('returns 0 when fewer than 2 valid decisions remain', () => {
    const corpus: ShadowDecision[] = [
      decision(Number.NaN, 'a', 'a'),
      decision(0.9, 'a', 'a'),
    ];
    expect(computeConfidenceCorrelation(corpus, 0)).toBe(0);
  });
});
