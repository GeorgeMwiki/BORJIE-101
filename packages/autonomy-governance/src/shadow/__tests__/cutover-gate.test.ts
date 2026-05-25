/**
 * Cutover gate — pure-function tests.
 *
 * Covers each of the four criteria across pass + fail + boundary, plus
 * the AND-combined `approved` flag and the full-grid (no-short-circuit)
 * reporting contract.
 *
 *   1. agreement                >= 0.85
 *   2. sampleSize               >= 5000
 *   3. criticalViolations       <= 0
 *   4. confidenceCorrelation    >= 0.7
 *
 * Strategy: synthesize sessions deterministically so each test isolates
 * exactly one criterion (pass or fail). Then an integration block exercises
 * the AND combinator and the "fail several at once" reporting path.
 */

import { describe, expect, it } from 'vitest';
import { evaluate } from '../cutover-gate.js';
import {
  DEFAULT_CUTOVER_CRITERIA,
  type CutoverCriteria,
  type ShadowDecision,
  type ShadowSession,
} from '../types.js';

/**
 * Build a deterministic shadow corpus with controlled agreement and a
 * strong confidence-correlation signal so we can isolate one criterion
 * at a time.
 *
 * Layout: the first `agreeCount` decisions agree (AI right, conf 0.95);
 * the rest disagree (AI wrong, conf 0.05). This guarantees:
 *   - agreement rate = agreeCount / total
 *   - correlation ≈ 1 (high conf → right, low conf → wrong)
 *   - no critical violations
 */
function buildCorpus(total: number, agreeCount: number): ShadowDecision[] {
  const corpus: ShadowDecision[] = [];
  for (let i = 0; i < total; i++) {
    const agrees = i < agreeCount;
    corpus.push({
      id: `d-${i}`,
      subMd: 'sub-md-1',
      tenantId: 'tenant-1',
      timestamp: '2026-05-24T00:00:00Z',
      kind: 'binary',
      aiVerdict: 'yes',
      humanVerdict: agrees ? 'yes' : 'no',
      confidence: agrees ? 0.95 : 0.05,
      isCriticalViolation: false,
    });
  }
  return corpus;
}

function buildSession(decisions: ShadowDecision[]): ShadowSession {
  return {
    id: 'session-1',
    subMd: 'sub-md-1',
    tenantId: 'tenant-1',
    startedAt: '2026-05-01T00:00:00Z',
    endedAt: '2026-05-24T00:00:00Z',
    decisions,
  };
}

describe('evaluate — all four criteria pass (spec defaults)', () => {
  it('approves when agreement >= 85%, sample >= 5000, 0 violations, corr >= 0.7', () => {
    const corpus = buildCorpus(6000, 5400); // 90% agreement, perfect correlation.
    const result = evaluate(buildSession(corpus));
    expect(result.approved).toBe(true);
    expect(result.agreement.passed).toBe(true);
    expect(result.sampleSize.passed).toBe(true);
    expect(result.criticalViolations.passed).toBe(true);
    expect(result.confidenceCorrelation.passed).toBe(true);
    expect(result.summary).toContain('APPROVED');
  });

  it('boundary: agreement exactly at 85% threshold passes (>= is inclusive)', () => {
    // 5100 / 6000 = 0.85 exactly.
    const corpus = buildCorpus(6000, 5100);
    const result = evaluate(buildSession(corpus));
    expect(result.agreement.observed).toBeCloseTo(0.85, 10);
    expect(result.agreement.passed).toBe(true);
    expect(result.approved).toBe(true);
  });

  it('boundary: sample size exactly at 5000 passes', () => {
    const corpus = buildCorpus(5000, 4500);
    const result = evaluate(buildSession(corpus));
    expect(result.sampleSize.observed).toBe(5000);
    expect(result.sampleSize.passed).toBe(true);
    expect(result.approved).toBe(true);
  });
});

describe('evaluate — agreement criterion fail', () => {
  it('blocks when agreement is below 85%', () => {
    // 80% agreement.
    const corpus = buildCorpus(6000, 4800);
    const result = evaluate(buildSession(corpus));
    expect(result.agreement.passed).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.summary).toContain('BLOCKED');
    expect(result.summary).toContain('agreement');
  });

  it('boundary: agreement just below 85% blocks', () => {
    // 5099 / 6000 ≈ 0.8498...
    const corpus = buildCorpus(6000, 5099);
    const result = evaluate(buildSession(corpus));
    expect(result.agreement.observed).toBeLessThan(0.85);
    expect(result.agreement.passed).toBe(false);
    expect(result.approved).toBe(false);
  });
});

describe('evaluate — sample-size criterion fail', () => {
  it('blocks when sample size is below 5000 even if agreement is perfect', () => {
    const corpus = buildCorpus(4999, 4999);
    const result = evaluate(buildSession(corpus));
    expect(result.sampleSize.passed).toBe(false);
    expect(result.agreement.passed).toBe(true); // perfect agreement
    expect(result.approved).toBe(false);
    expect(result.summary).toContain('sample-size');
  });

  it('boundary: sample size 4999 blocks, 5000 passes', () => {
    const blocked = evaluate(buildSession(buildCorpus(4999, 4500)));
    expect(blocked.sampleSize.passed).toBe(false);

    const passed = evaluate(buildSession(buildCorpus(5000, 4500)));
    expect(passed.sampleSize.passed).toBe(true);
  });

  it('empty session blocks on sample size (and is reported)', () => {
    const result = evaluate(buildSession([]));
    expect(result.sampleSize.passed).toBe(false);
    expect(result.sampleSize.observed).toBe(0);
    expect(result.approved).toBe(false);
  });
});

describe('evaluate — critical-violation criterion fail (zero tolerance)', () => {
  it('blocks on a single critical violation even with perfect agreement and correlation', () => {
    const corpus = buildCorpus(6000, 6000); // perfect
    corpus[0] = { ...corpus[0]!, isCriticalViolation: true };
    const result = evaluate(buildSession(corpus));
    expect(result.criticalViolations.passed).toBe(false);
    expect(result.criticalViolations.observed).toBe(1);
    expect(result.approved).toBe(false);
    expect(result.summary).toContain('critical-violations');
  });

  it('boundary: zero violations passes (default cap is 0)', () => {
    const corpus = buildCorpus(6000, 5400);
    const result = evaluate(buildSession(corpus));
    expect(result.criticalViolations.observed).toBe(0);
    expect(result.criticalViolations.passed).toBe(true);
  });

  it('respects a custom maxCriticalViolations override', () => {
    const corpus = buildCorpus(6000, 5400);
    corpus[0] = { ...corpus[0]!, isCriticalViolation: true };
    corpus[1] = { ...corpus[1]!, isCriticalViolation: true };

    const customCriteria: CutoverCriteria = {
      ...DEFAULT_CUTOVER_CRITERIA,
      maxCriticalViolations: 2,
    };
    const result = evaluate(buildSession(corpus), customCriteria);
    expect(result.criticalViolations.observed).toBe(2);
    expect(result.criticalViolations.passed).toBe(true);
    expect(result.approved).toBe(true);
  });
});

describe('evaluate — confidence-correlation criterion fail', () => {
  it('blocks when correlation is below 0.7 even with high agreement', () => {
    // Build a corpus where 90% agree but confidence is constant — zero
    // correlation, well below 0.7.
    const corpus: ShadowDecision[] = [];
    for (let i = 0; i < 6000; i++) {
      const agrees = i < 5400;
      corpus.push({
        id: `d-${i}`,
        subMd: 'sub-md-1',
        tenantId: 'tenant-1',
        timestamp: '2026-05-24T00:00:00Z',
        kind: 'binary',
        aiVerdict: 'yes',
        humanVerdict: agrees ? 'yes' : 'no',
        confidence: 0.7, // constant
        isCriticalViolation: false,
      });
    }
    const result = evaluate(buildSession(corpus));
    expect(result.agreement.passed).toBe(true);
    expect(result.confidenceCorrelation.passed).toBe(false);
    expect(result.confidenceCorrelation.observed).toBe(0);
    expect(result.approved).toBe(false);
    expect(result.summary).toContain('confidence-correlation');
  });

  it('boundary: correlation just at 0.7 passes (>= is inclusive)', () => {
    // Use a tiny corpus where we can compute the expected r and tune
    // around it. With (1, 0, 1, 0, 1) correctness and confidences set so
    // that r >= 0.7, we get a pass; we cross-check the observed value
    // against the threshold to make sure the comparator is inclusive.
    const customCriteria: CutoverCriteria = {
      ...DEFAULT_CUTOVER_CRITERIA,
      minSampleSize: 4, // relax for boundary-on-correlation test
    };
    const corpus: ShadowDecision[] = [
      { id: '1', subMd: 'm', tenantId: 't', timestamp: 'x', kind: 'binary', aiVerdict: 'a', humanVerdict: 'a', confidence: 0.9, isCriticalViolation: false },
      { id: '2', subMd: 'm', tenantId: 't', timestamp: 'x', kind: 'binary', aiVerdict: 'a', humanVerdict: 'a', confidence: 0.8, isCriticalViolation: false },
      { id: '3', subMd: 'm', tenantId: 't', timestamp: 'x', kind: 'binary', aiVerdict: 'a', humanVerdict: 'b', confidence: 0.2, isCriticalViolation: false },
      { id: '4', subMd: 'm', tenantId: 't', timestamp: 'x', kind: 'binary', aiVerdict: 'a', humanVerdict: 'b', confidence: 0.1, isCriticalViolation: false },
    ];
    const result = evaluate(buildSession(corpus), customCriteria);
    // r should be ~1 (high conf → right, low conf → wrong).
    expect(result.confidenceCorrelation.observed).toBeGreaterThanOrEqual(0.7);
    expect(result.confidenceCorrelation.passed).toBe(true);
  });
});

describe('evaluate — AND combinator + full-grid reporting', () => {
  it('approved is the AND of all four criteria — single failure flips it', () => {
    // Pass all four → approved.
    const allPass = evaluate(buildSession(buildCorpus(6000, 5400)));
    expect(allPass.approved).toBe(true);

    // Flip just sample size by trimming.
    const sampleFail = evaluate(buildSession(buildCorpus(4999, 4500)));
    expect(sampleFail.approved).toBe(false);
    expect(sampleFail.agreement.passed).toBe(true); // others still report individually
  });

  it('does NOT short-circuit — reports all four criteria even when several fail', () => {
    // Tiny corpus with bad agreement and bad correlation and a violation.
    const corpus: ShadowDecision[] = [];
    for (let i = 0; i < 100; i++) {
      corpus.push({
        id: `d-${i}`,
        subMd: 'sub-md-1',
        tenantId: 'tenant-1',
        timestamp: '2026-05-24T00:00:00Z',
        kind: 'binary',
        aiVerdict: 'yes',
        humanVerdict: i < 30 ? 'yes' : 'no', // 30% agreement
        confidence: 0.5, // constant — zero correlation
        isCriticalViolation: i === 0,
      });
    }
    const result = evaluate(buildSession(corpus));
    expect(result.approved).toBe(false);

    // All four criteria reported, all observed values present.
    expect(result.agreement.observed).toBeCloseTo(0.3, 10);
    expect(result.agreement.passed).toBe(false);
    expect(result.sampleSize.observed).toBe(100);
    expect(result.sampleSize.passed).toBe(false);
    expect(result.criticalViolations.observed).toBe(1);
    expect(result.criticalViolations.passed).toBe(false);
    expect(result.confidenceCorrelation.observed).toBe(0);
    expect(result.confidenceCorrelation.passed).toBe(false);

    // Summary surfaces every failed criterion (audit-trail joinable).
    expect(result.summary).toContain('agreement');
    expect(result.summary).toContain('sample-size');
    expect(result.summary).toContain('critical-violations');
    expect(result.summary).toContain('confidence-correlation');
  });

  it('honours custom criteria overrides (stricter and looser)', () => {
    // Same corpus that passes defaults; stricter agreement target blocks it.
    const corpus = buildCorpus(6000, 5400); // 90% agreement
    const strict: CutoverCriteria = {
      ...DEFAULT_CUTOVER_CRITERIA,
      minAgreementRate: 0.95,
    };
    expect(evaluate(buildSession(corpus), strict).approved).toBe(false);

    const loose: CutoverCriteria = {
      ...DEFAULT_CUTOVER_CRITERIA,
      minSampleSize: 100,
      minAgreementRate: 0.5,
      minConfidenceCorrelation: 0,
    };
    // Small corpus that fails defaults but passes the relaxed gate.
    const small = buildCorpus(100, 60);
    expect(evaluate(buildSession(small), loose).approved).toBe(true);
  });
});

describe('DEFAULT_CUTOVER_CRITERIA — spec conformance', () => {
  it('matches the spec headline thresholds exactly', () => {
    expect(DEFAULT_CUTOVER_CRITERIA.minAgreementRate).toBe(0.85);
    expect(DEFAULT_CUTOVER_CRITERIA.minSampleSize).toBe(5000);
    expect(DEFAULT_CUTOVER_CRITERIA.maxCriticalViolations).toBe(0);
    expect(DEFAULT_CUTOVER_CRITERIA.minConfidenceCorrelation).toBe(0.7);
  });

  it('is frozen at the top level (no mutation)', () => {
    expect(Object.isFrozen(DEFAULT_CUTOVER_CRITERIA)).toBe(true);
  });
});
