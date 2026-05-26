/**
 * Reward shaper — binary, partial, weighted, skip-exclusion.
 */

import { describe, expect, it } from 'vitest';
import { shapeReward } from '../reward/reward-shaper.js';
import type { VerificationResult } from '../types.js';

function r(
  name: string,
  verdict: VerificationResult['verdict'],
  reward: number,
): VerificationResult {
  return Object.freeze({
    verifierName: name,
    verdict,
    reward,
    evidence: {},
    confidence: 1,
  });
}

describe('shapeReward', () => {
  it('averages binary verdicts (skip excluded)', () => {
    const shape = shapeReward({
      traceId: 't',
      results: [
        r('a', 'pass', 1),
        r('b', 'fail', 0),
        r('c', 'skip', 0),
      ],
    });
    expect(shape.aggregate).toBe(0.5);
    expect(shape.effectiveWeight).toBe(2);
    expect(shape.anyFail).toBe(true);
  });

  it('combines partial rewards', () => {
    const shape = shapeReward({
      traceId: 't',
      results: [
        r('a', 'pass', 1),
        r('b', 'partial', 0.6),
      ],
    });
    expect(shape.aggregate).toBeCloseTo(0.8);
    expect(shape.anyFail).toBe(false);
  });

  it('weights verifiers as configured', () => {
    const shape = shapeReward({
      traceId: 't',
      results: [
        r('a', 'pass', 1),
        r('b', 'fail', 0),
      ],
      weights: { a: 3, b: 1 },
    });
    expect(shape.aggregate).toBeCloseTo(0.75);
  });

  it('zero-weight verifier is excluded from aggregate', () => {
    const shape = shapeReward({
      traceId: 't',
      results: [
        r('a', 'pass', 1),
        r('b', 'fail', 0),
      ],
      weights: { a: 1, b: 0 },
    });
    expect(shape.aggregate).toBe(1);
  });

  it('all-skip → aggregate 0 + effective weight 0', () => {
    const shape = shapeReward({
      traceId: 't',
      results: [r('a', 'skip', 0), r('b', 'skip', 0)],
    });
    expect(shape.aggregate).toBe(0);
    expect(shape.effectiveWeight).toBe(0);
    expect(shape.anyFail).toBe(false);
  });
});
