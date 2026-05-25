/**
 * Tests for skill-promotion/significance-gate.
 *
 * Coverage:
 *   - rejects low-N (occurrences < threshold)
 *   - rejects low-success (success rate < 0.85)
 *   - rejects when χ² < critical (baseline coin-flip with too few samples)
 *   - promotes when all three conditions hold
 *   - reports the FIRST failing condition in `reason`
 *   - exposes χ² statistic + critical value for audit
 */

import { describe, it, expect } from 'vitest';
import { evaluateCandidate, evaluateCandidates } from '../significance-gate.js';
import type { CandidateSkill } from '../types.js';

function candidate(
  occurrences: number,
  successCount: number,
  failureCount: number,
): CandidateSkill {
  return {
    codeHash: `h_${occurrences}_${successCount}_${failureCount}`,
    tenantId: null,
    toolSequence: [{ toolName: 'a' }, { toolName: 'b' }],
    occurrences,
    successCount,
    failureCount,
    firstSeenAt: '2026-05-24T00:00:00.000Z',
    lastSeenAt: '2026-05-24T00:00:00.000Z',
  };
}

describe('evaluateCandidate — rejection paths', () => {
  it('rejects when occurrences < 5 (low-N)', () => {
    const decision = evaluateCandidate(candidate(3, 3, 0));
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('occurrences_below_threshold');
  });

  it('rejects when occurrences exactly = 4 (boundary)', () => {
    const decision = evaluateCandidate(candidate(4, 4, 0));
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('occurrences_below_threshold');
  });

  it('rejects when success rate < 0.85', () => {
    // 10 occurrences, 7 success, 3 failure = 0.70 < 0.85
    const decision = evaluateCandidate(candidate(10, 7, 3));
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('success_rate_below_threshold');
  });

  it('rejects when success rate exactly = 0.84 (boundary)', () => {
    // 50 trials, 42 success, 8 failure = 0.84 < 0.85
    const decision = evaluateCandidate(candidate(50, 42, 8));
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('success_rate_below_threshold');
  });

  it('rejects when χ² is below the 3.841 critical value', () => {
    // 5 occurrences, 5 success, 0 failure → success rate 1.0 (passes the
    // 0.85 gate) and N=5 (passes the occurrence gate) but χ² against a
    // 0.5 baseline = 5.0 — which would PASS. So pick a case at the edge:
    // 5 success / 0 failure has χ² = 5 > 3.841 — significant.
    // Use 5 occurrences, 5 success, 0 failure but raise the baseline to
    // 0.95 so the expected = observed and χ² ≈ 0 → not significant.
    const decision = evaluateCandidate(candidate(5, 5, 0), {
      baselineSuccessRate: 0.95,
    });
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('chi_squared_not_significant');
  });
});

describe('evaluateCandidate — promotion path', () => {
  it('promotes when all three conditions hold (N=5, success=5, χ²=5)', () => {
    // 5 trials, 5 success vs. coin-flip baseline:
    // E_S = 2.5, E_F = 2.5; χ² = (2.5)²/2.5 + (2.5)²/2.5 = 5.0 > 3.841
    const decision = evaluateCandidate(candidate(5, 5, 0));
    expect(decision.verdict).toBe('promote');
    expect(decision.reason).toBe('significant');
    expect(decision.chiSquared).toBeGreaterThanOrEqual(3.841);
    expect(decision.successRate).toBe(1.0);
  });

  it('promotes for clearly successful pattern (10/10)', () => {
    const decision = evaluateCandidate(candidate(10, 10, 0));
    expect(decision.verdict).toBe('promote');
    expect(decision.chiSquared).toBe(10); // (5)²/5 + (5)²/5
  });

  it('promotes at the 0.85 boundary when N and χ² both pass', () => {
    // 20 occurrences, 17 success, 3 failure = exactly 0.85 → eligible.
    // χ² = (17 − 10)²/10 + (3 − 10)²/10 = 49/10 + 49/10 = 9.8 > 3.841.
    const decision = evaluateCandidate(candidate(20, 17, 3));
    expect(decision.verdict).toBe('promote');
    expect(decision.successRate).toBeCloseTo(0.85, 5);
  });
});

describe('evaluateCandidate — audit surface', () => {
  it('always exposes chiSquared and chiSquaredCritical', () => {
    const decision = evaluateCandidate(candidate(3, 3, 0));
    expect(typeof decision.chiSquared).toBe('number');
    expect(decision.chiSquaredCritical).toBe(3.841);
  });

  it('respects the minOccurrences override', () => {
    const decision = evaluateCandidate(candidate(3, 3, 0), {
      minOccurrences: 2,
    });
    // Now 3 ≥ 2 passes occurrence; success-rate 1.0 ≥ 0.85; χ² = 3.0 < 3.841.
    expect(decision.verdict).toBe('reject');
    expect(decision.reason).toBe('chi_squared_not_significant');
  });

  it('respects the minSuccessRate override (allows lower-quality skills)', () => {
    // 30 trials, 21 success, 9 failure → rate=0.70, χ²=(6)²/15+(6)²/15=4.8.
    // Default floor=0.85 would reject; lowering to 0.6 lets it through.
    const decision = evaluateCandidate(candidate(30, 21, 9), {
      minSuccessRate: 0.6,
    });
    expect(decision.verdict).toBe('promote');
    expect(decision.successRate).toBeCloseTo(0.7, 5);
  });
});

describe('evaluateCandidates — batch', () => {
  it('preserves input order across the batch', () => {
    const input = [
      candidate(3, 3, 0), // reject (low-N)
      candidate(10, 10, 0), // promote
      candidate(10, 7, 3), // reject (low-success)
    ];
    const decisions = evaluateCandidates(input);
    expect(decisions).toHaveLength(3);
    expect(decisions[0]?.verdict).toBe('reject');
    expect(decisions[1]?.verdict).toBe('promote');
    expect(decisions[2]?.verdict).toBe('reject');
  });
});
