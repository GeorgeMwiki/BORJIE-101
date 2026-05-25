/**
 * Agreement scorer — pure-function tests.
 *
 * Covers each criterion across pass + fail + boundary:
 *   - Binary exact-match equivalence (string, number, boolean verdicts).
 *   - Numeric threshold equivalence (within tolerance, exactly-equal-to,
 *     just-over-tolerance, mismatched types).
 *   - Empty corpus → 0 (documented contract).
 *   - Mixed binary + numeric in one session.
 *   - Critical-violation counter.
 *   - Defensive: NaN / negative tolerance treated as configuration error.
 */

import { describe, expect, it } from 'vitest';
import {
  computeAgreementRate,
  countCriticalViolations,
  isEquivalent,
} from '../agreement-scorer.js';
import type { ShadowDecision } from '../types.js';

function makeBinaryDecision(
  overrides: Partial<ShadowDecision> = {},
): ShadowDecision {
  return {
    id: 'd1',
    subMd: 'sub-md-1',
    tenantId: 'tenant-1',
    timestamp: '2026-05-24T00:00:00Z',
    kind: 'binary',
    aiVerdict: 'approve',
    humanVerdict: 'approve',
    confidence: 0.9,
    isCriticalViolation: false,
    ...overrides,
  };
}

function makeNumericDecision(
  overrides: Partial<ShadowDecision> = {},
): ShadowDecision {
  return {
    id: 'n1',
    subMd: 'sub-md-1',
    tenantId: 'tenant-1',
    timestamp: '2026-05-24T00:00:00Z',
    kind: 'numeric',
    aiVerdict: 100,
    humanVerdict: 100,
    confidence: 0.9,
    isCriticalViolation: false,
    ...overrides,
  };
}

describe('isEquivalent — binary exact-match', () => {
  it('matches on identical string verdicts', () => {
    expect(isEquivalent(makeBinaryDecision({ aiVerdict: 'yes', humanVerdict: 'yes' }), 0)).toBe(true);
  });

  it('mismatches on differing string verdicts', () => {
    expect(isEquivalent(makeBinaryDecision({ aiVerdict: 'yes', humanVerdict: 'no' }), 0)).toBe(false);
  });

  it('matches on identical boolean verdicts', () => {
    expect(isEquivalent(makeBinaryDecision({ aiVerdict: true, humanVerdict: true }), 0)).toBe(true);
  });

  it('matches on identical numeric verdicts in binary mode (===)', () => {
    expect(isEquivalent(makeBinaryDecision({ aiVerdict: 42, humanVerdict: 42 }), 0)).toBe(true);
  });

  it('mismatches on near-but-not-equal numeric verdicts in binary mode (no tolerance)', () => {
    // Binary mode is strict === — no tolerance applied.
    expect(isEquivalent(makeBinaryDecision({ aiVerdict: 42, humanVerdict: 43 }), 100)).toBe(false);
  });
});

describe('isEquivalent — numeric threshold-bounded', () => {
  it('matches when |ai - human| equals tolerance (boundary, inclusive)', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 105 }), 5)).toBe(true);
  });

  it('matches when |ai - human| < tolerance', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 102 }), 5)).toBe(true);
  });

  it('mismatches when |ai - human| > tolerance', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 110 }), 5)).toBe(false);
  });

  it('zero tolerance requires exact equality', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 100 }), 0)).toBe(true);
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 100.01 }), 0)).toBe(false);
  });

  it('mismatches when verdict types are not numeric', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: '100', humanVerdict: 100 }), 5)).toBe(false);
  });

  it('mismatches when either verdict is NaN', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: Number.NaN, humanVerdict: 100 }), 5)).toBe(false);
  });

  it('mismatches when tolerance is negative (configuration error)', () => {
    expect(isEquivalent(makeNumericDecision({ aiVerdict: 100, humanVerdict: 100 }), -1)).toBe(false);
  });
});

describe('computeAgreementRate — pass / fail / boundary', () => {
  it('returns 1.0 when every decision agrees', () => {
    const corpus = Array.from({ length: 10 }, () => makeBinaryDecision());
    expect(computeAgreementRate(corpus, 0)).toBe(1);
  });

  it('returns 0.0 when no decision agrees', () => {
    const corpus = Array.from({ length: 10 }, () =>
      makeBinaryDecision({ aiVerdict: 'yes', humanVerdict: 'no' }),
    );
    expect(computeAgreementRate(corpus, 0)).toBe(0);
  });

  it('returns 0 for empty corpus (documented contract)', () => {
    expect(computeAgreementRate([], 0)).toBe(0);
  });

  it('returns exact fraction for partial agreement (8/10 = 0.8)', () => {
    const corpus = [
      ...Array.from({ length: 8 }, () => makeBinaryDecision()),
      ...Array.from({ length: 2 }, () =>
        makeBinaryDecision({ aiVerdict: 'a', humanVerdict: 'b' }),
      ),
    ];
    expect(computeAgreementRate(corpus, 0)).toBe(0.8);
  });

  it('boundary: 85% agreement (the spec threshold) is computed exactly', () => {
    // 85 agree, 15 disagree out of 100.
    const corpus = [
      ...Array.from({ length: 85 }, () => makeBinaryDecision()),
      ...Array.from({ length: 15 }, () =>
        makeBinaryDecision({ aiVerdict: 'a', humanVerdict: 'b' }),
      ),
    ];
    expect(computeAgreementRate(corpus, 0)).toBeCloseTo(0.85, 10);
  });

  it('mixed binary + numeric corpus dispatches per-decision', () => {
    const corpus: ShadowDecision[] = [
      makeBinaryDecision({ aiVerdict: 'yes', humanVerdict: 'yes' }),
      makeNumericDecision({ aiVerdict: 100, humanVerdict: 103 }),
      makeBinaryDecision({ aiVerdict: 'yes', humanVerdict: 'no' }),
      makeNumericDecision({ aiVerdict: 200, humanVerdict: 250 }),
    ];
    // Binary 1/2 = .5, numeric 1/2 = .5, overall 2/4 = .5 at tolerance=5.
    expect(computeAgreementRate(corpus, 5)).toBe(0.5);
  });

  it('NaN tolerance is treated as configuration error — numeric pairs do not count', () => {
    const corpus = [
      makeNumericDecision({ aiVerdict: 100, humanVerdict: 100 }),
      makeNumericDecision({ aiVerdict: 100, humanVerdict: 100 }),
    ];
    expect(computeAgreementRate(corpus, Number.NaN)).toBe(0);
  });
});

describe('countCriticalViolations — pass / fail / boundary', () => {
  it('returns 0 when no decision is a critical violation', () => {
    const corpus = Array.from({ length: 100 }, () => makeBinaryDecision());
    expect(countCriticalViolations(corpus)).toBe(0);
  });

  it('returns 0 on empty corpus', () => {
    expect(countCriticalViolations([])).toBe(0);
  });

  it('counts every critical violation in a mixed corpus', () => {
    const corpus = [
      makeBinaryDecision(),
      makeBinaryDecision({ isCriticalViolation: true }),
      makeBinaryDecision(),
      makeBinaryDecision({ isCriticalViolation: true }),
      makeBinaryDecision({ isCriticalViolation: true }),
    ];
    expect(countCriticalViolations(corpus)).toBe(3);
  });

  it('boundary: a single violation is the cutover-blocking minimum', () => {
    const corpus = [
      ...Array.from({ length: 9999 }, () => makeBinaryDecision()),
      makeBinaryDecision({ isCriticalViolation: true }),
    ];
    expect(countCriticalViolations(corpus)).toBe(1);
  });
});
