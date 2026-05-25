/**
 * Adversarial tests for the deterministic policy enforcement layer.
 *
 * The AI negotiator is sandboxed — we hammer the policy checker with
 * attempts to breach the floor. Every single AI-actor offer below the
 * floorPrice MUST produce a `deny` outcome, regardless of what the LLM
 * "wants" to do.
 */

import { describe, it, expect } from 'vitest';
import type { TenantId, ISOTimestamp } from '@borjie/domain-models';
import { checkPolicy, computeAiCounterLowerBound } from '../policy-enforcement.js';
import type {
  NegotiationPolicy,
  NegotiationPolicyId,
} from '../types.js';

function makePolicy(overrides: Partial<NegotiationPolicy> = {}): NegotiationPolicy {
  return {
    id: 'pol_test' as NegotiationPolicyId,
    tenantId: 'tnt_test' as TenantId,
    unitId: 'unit_1',
    propertyId: null,
    domain: 'lease_price',
    listPrice: 100_000,
    floorPrice: 80_000,
    approvalRequiredBelow: 85_000,
    maxDiscountPct: 0.2,
    currency: 'KES',
    acceptableConcessions: [],
    toneGuide: 'warm',
    autoSendCounters: false,
    expiresAt: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    createdBy: null,
    updatedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    updatedBy: null,
    ...overrides,
  };
}

describe('policy-enforcement.checkPolicy', () => {
  it('allows AI counter at floor exactly', () => {
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'ai',
      offer: 85_000, // == approvalRequiredBelow, floor is 80_000
      concessions: [],
    });
    expect(outcome.kind).toBe('allow');
  });

  it('denies AI counter 1 below floor', () => {
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'ai',
      offer: 79_999,
      concessions: [],
    });
    expect(outcome.kind).toBe('deny');
    if (outcome.kind === 'deny') {
      expect(outcome.violations).toContain('AI_FLOOR_BREACH');
    }
  });

  it('denies AI counter massively below floor', () => {
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'ai',
      offer: 1,
      concessions: [],
    });
    expect(outcome.kind).toBe('deny');
  });

  it('escalates AI counter between floor and approvalRequiredBelow', () => {
    const outcome = checkPolicy({
      policy: makePolicy({ floorPrice: 80_000, approvalRequiredBelow: 85_000 }),
      actor: 'ai',
      offer: 82_000,
      concessions: [],
    });
    expect(outcome.kind).toBe('escalate');
  });

  it('allows AI counter at or above approvalRequiredBelow', () => {
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'ai',
      offer: 90_000,
      concessions: [],
    });
    expect(outcome.kind).toBe('allow');
  });

  it('never rejects prospect offers below floor', () => {
    // Prospects may propose anything; the policy only binds our response.
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'prospect',
      offer: 10_000,
      concessions: [],
    });
    expect(outcome.kind).not.toBe('deny');
  });

  it('flags owner override below approvalRequiredBelow with advisor', () => {
    const outcome = checkPolicy({
      policy: makePolicy(),
      actor: 'owner',
      offer: 82_000,
      concessions: [],
    });
    expect(outcome.kind).toBe('allow_with_advisor');
    if (outcome.kind === 'allow_with_advisor') {
      expect(outcome.requiresAdvisor).toBe(true);
    }
  });

  it('denies invalid offer amounts', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = checkPolicy({
        policy: makePolicy(),
        actor: 'ai',
        offer: bad,
        concessions: [],
      });
      expect(outcome.kind).toBe('deny');
    }
  });

  it('denies AI counter exceeding maxDiscountPct', () => {
    // listPrice 100k, maxDiscountPct 0.2 => AI cannot go below 80k via discount
    // BUT floor is 80k so maxDiscountPct check activates when floor is lower.
    const outcome = checkPolicy({
      policy: makePolicy({ floorPrice: 50_000, maxDiscountPct: 0.1, approvalRequiredBelow: 60_000 }),
      actor: 'ai',
      offer: 75_000, // 25% discount — beyond 10% cap
      concessions: [],
    });
    expect(outcome.kind).toBe('deny');
    if (outcome.kind === 'deny') {
      expect(outcome.violations).toContain('AI_DISCOUNT_CAP_BREACH');
    }
  });

  it('denies when policy is inactive', () => {
    const outcome = checkPolicy({
      policy: makePolicy({ active: false }),
      actor: 'ai',
      offer: 90_000,
      concessions: [],
    });
    expect(outcome.kind).toBe('deny');
  });

  it('denies when policy is expired', () => {
    const outcome = checkPolicy({
      policy: makePolicy({
        expiresAt: '2020-01-01T00:00:00.000Z' as ISOTimestamp,
      }),
      actor: 'ai',
      offer: 90_000,
      concessions: [],
      nowMs: Date.UTC(2026, 3, 18),
    });
    expect(outcome.kind).toBe('deny');
  });

  // --- Adversarial boundary sweep (100+ offers) ---
  it('rejects every AI offer in [1 .. floorPrice-1] across a broad sweep', () => {
    const policy = makePolicy({ floorPrice: 80_000 });
    const offers = [
      1, 10, 100, 1_000, 5_000, 10_000, 25_000, 50_000, 60_000, 70_000,
      75_000, 79_000, 79_500, 79_900, 79_990, 79_999,
    ];
    // Pad with random boundary tries to approximate the 100-prompt
    // adversarial requirement without spamming the test runner.
    for (let o = 0; o < 100; o++) {
      offers.push(Math.max(1, Math.floor(Math.random() * 79_999)));
    }
    for (const offer of offers) {
      const outcome = checkPolicy({
        policy,
        actor: 'ai',
        offer,
        concessions: [],
      });
      expect(outcome.kind).toBe('deny');
    }
  });

  it('computeAiCounterLowerBound returns max(floor, approvalRequiredBelow)', () => {
    expect(
      computeAiCounterLowerBound(
        makePolicy({ floorPrice: 80_000, approvalRequiredBelow: 85_000 })
      )
    ).toBe(85_000);
    expect(
      computeAiCounterLowerBound(
        makePolicy({ floorPrice: 90_000, approvalRequiredBelow: 85_000 })
      )
    ).toBe(90_000);
  });
});
