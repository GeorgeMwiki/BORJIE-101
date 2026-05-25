/**
 * Tests for learning-loop/confidence-scorer.
 *
 * Coverage: baseline math, trusted-feature lift, risk-feature drag,
 * legal/safety-critical penalty, historical-success adjustment, clamp,
 * LLM adjustment success / parse-fail / throw, requiresHumanReview gate.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createConfidenceScorer,
  requiresHumanReview,
  LOW_CONFIDENCE_THRESHOLD,
} from '../confidence-scorer.js';
import type {
  ConfidenceContext,
  ConfidenceScore,
  OutcomeEvent,
  OutcomeRepository,
} from '../types.js';
import type { ClassifyLLMPort } from '../../ai-native/shared.js';

const baseCtx: ConfidenceContext = {
  tenantId: 't1',
  domain: 'finance',
  actionType: 'auto_approve_refund',
  features: {},
};

function ctx(features: Record<string, unknown>): ConfidenceContext {
  return { ...baseCtx, features };
}

describe('createConfidenceScorer.scoreActionSync', () => {
  it('returns baseline 0.5 with no features and no history', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(baseCtx);
    expect(score.value).toBe(0.5);
    expect(score.baseline).toBe(0.5);
    expect(score.llmAdjustment).toBe(0);
    expect(score.reasoning).toContain('baseline=0.5');
  });

  it('lifts +0.05 per trusted boolean feature', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(
      ctx({ vendorIsTrusted: true, tenantInGoodStanding: true }),
    );
    // 0.5 + 2 * 0.05 = 0.6
    expect(score.value).toBeCloseTo(0.6);
    expect(score.reasoning).toContain('trusted-features(2)');
  });

  it('drags -0.05 per risk feature', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(
      ctx({ disputeInFlight: true, firstTimeAction: true }),
    );
    // 0.5 - 2 * 0.05 = 0.4
    expect(score.value).toBeCloseTo(0.4);
    expect(score.reasoning).toContain('risk-features(2)');
  });

  it('applies the -0.15 penalty for legal notice context', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(ctx({ isLegalNotice: true }));
    // baseline 0.5, risk -0.05 (isLegalNotice IS in risk list too), legal -0.15
    expect(score.value).toBeCloseTo(0.3);
    expect(score.reasoning).toContain('legal/safety-critical');
  });

  it('applies the -0.15 penalty for safety-critical', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(ctx({ isSafetyCritical: true }));
    // baseline 0.5, risk -0.05, safety-critical -0.15 -> 0.3
    expect(score.value).toBeCloseTo(0.3);
  });

  it('uses historical success-rate >= 0.8 to add +0.10', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(baseCtx, 0.9);
    // 0.5 + 0.10 = 0.6
    expect(score.value).toBeCloseTo(0.6);
    expect(score.reasoning).toContain('historical-success=0.90');
  });

  it('uses historical success-rate <= 0.5 to subtract -0.10', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(baseCtx, 0.4);
    // 0.5 - 0.10 = 0.4
    expect(score.value).toBeCloseTo(0.4);
    expect(score.reasoning).toContain('historical-success=0.40');
  });

  it('clamps the value to [0,1]', () => {
    const scorer = createConfidenceScorer();
    // 4 trusted (+0.20) + history (+0.10) = 0.80; ok
    const top = scorer.scoreActionSync(
      ctx({
        vendorIsTrusted: true,
        tenantInGoodStanding: true,
        approvedByPrimary: true,
        withinQuietHours: true,
      }),
      0.95,
    );
    expect(top.value).toBeLessThanOrEqual(1);
    expect(top.value).toBeGreaterThan(0.5);

    // strong risks + legal + low history → easily under 0
    const bottom = scorer.scoreActionSync(
      ctx({
        isLegalNotice: true,
        isSafetyCritical: true,
        disputeInFlight: true,
        firstTimeAction: true,
      }),
      0.1,
    );
    expect(bottom.value).toBeGreaterThanOrEqual(0);
  });
});

describe('createConfidenceScorer.scoreAction (async)', () => {
  function makeOutcomes(events: OutcomeEvent[]): OutcomeRepository {
    return {
      async insert(o) {
        return o;
      },
      async updateStatus() {
        return null;
      },
      async findByTenant() {
        return events;
      },
      async findByActionId() {
        return null;
      },
    };
  }

  function makeOutcome(outcome: OutcomeEvent['outcome']): OutcomeEvent {
    return {
      actionId: 'a',
      tenantId: 't1',
      domain: 'finance',
      actionType: 'auto_approve_refund',
      context: {},
      decision: 'd',
      rationale: 'r',
      confidence: 0.5,
      executedAt: new Date().toISOString(),
      outcome,
    };
  }

  it('falls back to sync (no LLM) when LLM is not provided', async () => {
    const scorer = createConfidenceScorer();
    const score = await scorer.scoreAction(baseCtx);
    expect(score.llmAdjustment).toBe(0);
    expect(score.value).toBe(score.baseline);
  });

  it('reads historical success-rate from the outcome repository', async () => {
    const events = [
      makeOutcome('success'),
      makeOutcome('success'),
      makeOutcome('success'),
      makeOutcome('failure'),
    ];
    const scorer = createConfidenceScorer({ outcomes: makeOutcomes(events) });
    const score = await scorer.scoreAction(baseCtx);
    // 3/4 = 0.75 — neither >= 0.8 nor <= 0.5, baseline only
    expect(score.value).toBeCloseTo(0.5);
  });

  function llmReturning(raw: string): ClassifyLLMPort {
    return {
      async classify() {
        return { raw, modelVersion: 'test', inputTokens: 0, outputTokens: 0 };
      },
    };
  }

  it('applies LLM adjustment when LLM returns valid JSON', async () => {
    const scorer = createConfidenceScorer({
      llm: llmReturning('{"adjustment": 0.15, "reason": "good rationale"}'),
    });
    const score = await scorer.scoreAction(baseCtx);
    expect(score.llmAdjustment).toBeCloseTo(0.15);
    expect(score.value).toBeCloseTo(0.65);
    expect(score.reasoning).toContain('llm=0.15');
  });

  it('clamps LLM adjustment to [-0.2, 0.2]', async () => {
    const scorer = createConfidenceScorer({
      llm: llmReturning('{"adjustment": 0.9, "reason": "x"}'),
    });
    const score = await scorer.scoreAction(baseCtx);
    expect(score.llmAdjustment).toBeCloseTo(0.2);
    expect(score.value).toBeCloseTo(0.7);
  });

  it('falls back to sync when LLM returns malformed JSON', async () => {
    const scorer = createConfidenceScorer({ llm: llmReturning('not json at all') });
    const score = await scorer.scoreAction(baseCtx);
    expect(score.llmAdjustment).toBe(0);
    expect(score.value).toBe(score.baseline);
  });

  it('falls back to sync when LLM throws', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        throw new Error('boom');
      },
    };
    const scorer = createConfidenceScorer({ llm });
    const score = await scorer.scoreAction(baseCtx);
    expect(score.llmAdjustment).toBe(0);
    expect(score.value).toBe(score.baseline);
  });

  it('respects an injected lookback window', async () => {
    const findByTenant = vi.fn(async () => []);
    const repo: OutcomeRepository = {
      async insert(o) {
        return o;
      },
      async updateStatus() {
        return null;
      },
      findByTenant,
      async findByActionId() {
        return null;
      },
    };
    const fixedNow = new Date('2026-04-01T00:00:00.000Z');
    const scorer = createConfidenceScorer({
      outcomes: repo,
      now: () => fixedNow,
      lookbackMs: 1000,
    });
    await scorer.scoreAction(baseCtx);
    expect(findByTenant).toHaveBeenCalledWith('t1', expect.objectContaining({
      since: new Date(fixedNow.getTime() - 1000).toISOString(),
    }));
  });
});

describe('createConfidenceScorer — numerical-contradiction penalty (May 18 §5 closure)', () => {
  it('applies no penalty when the feature is absent', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(baseCtx);
    expect(score.value).toBe(0.5);
    expect(score.reasoning).not.toContain('numerical-contradictions');
  });

  it('applies linear penalty for 1 contradiction (-0.08)', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(ctx({ numericalContradictionCount: 1 }));
    expect(score.value).toBeCloseTo(0.42, 5);
    expect(score.reasoning).toContain('numerical-contradictions(1)');
  });

  it('caps at -0.24 for 3+ contradictions', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(ctx({ numericalContradictionCount: 10 }));
    expect(score.value).toBeCloseTo(0.26, 5);
    expect(score.reasoning).toContain('numerical-contradictions(10)');
  });

  it('ignores non-positive, NaN, or non-numeric values', () => {
    const scorer = createConfidenceScorer();
    expect(scorer.scoreActionSync(ctx({ numericalContradictionCount: 0 })).value).toBe(0.5);
    expect(scorer.scoreActionSync(ctx({ numericalContradictionCount: -3 })).value).toBe(0.5);
    expect(scorer.scoreActionSync(ctx({ numericalContradictionCount: NaN })).value).toBe(0.5);
    expect(scorer.scoreActionSync(ctx({ numericalContradictionCount: 'two' })).value).toBe(0.5);
  });

  it('stacks with legal-notice penalty without exceeding clamp', () => {
    const scorer = createConfidenceScorer();
    const score = scorer.scoreActionSync(
      ctx({ numericalContradictionCount: 3, isLegalNotice: true }),
    );
    // 0.5 - 0.15 (legal) - 0.24 (contra) - 0.05 (risk-feature isLegalNotice) = 0.06
    expect(score.value).toBeCloseTo(0.06, 5);
  });
});

describe('requiresHumanReview', () => {
  function score(value: number): ConfidenceScore {
    return { value, baseline: value, llmAdjustment: 0, reasoning: '' };
  }

  it('flips to true below the threshold', () => {
    expect(requiresHumanReview(score(LOW_CONFIDENCE_THRESHOLD - 0.01))).toBe(true);
  });

  it('returns false at the exact threshold (open lower bound)', () => {
    expect(requiresHumanReview(score(LOW_CONFIDENCE_THRESHOLD))).toBe(false);
  });

  it('returns false above the threshold', () => {
    expect(requiresHumanReview(score(0.95))).toBe(false);
  });
});
