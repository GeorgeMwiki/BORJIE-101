/**
 * Deterministic policy enforcement for the AI Price Negotiation engine.
 *
 * CRITICAL DESIGN NOTE
 * --------------------
 * All enforcement runs BEFORE any LLM call and AFTER the LLM returns a
 * candidate counter. The LLM is sandboxed: even if it hallucinates or is
 * prompt-injected into proposing a below-floor offer, the policy check
 * will reject the turn and escalate. The AI is NEVER autonomous.
 *
 * Invariants (adversarial-tested):
 *   1. An AI-actor offer < `floorPrice` is ALWAYS rejected.
 *   2. An AI-actor offer below `approvalRequiredBelow` is auto-escalated.
 *   3. Prospect/counterparty offers are NEVER rejected on floor grounds —
 *      they may propose anything; policy only constrains our response.
 *   4. Human owners/agents may override floor but are audited.
 *   5. maxDiscountPct is a secondary check: `(list - offer) / list <= pct`.
 */

import type {
  NegotiationPolicy,
  NegotiationActor,
  NegotiationConcession,
} from './types.js';

export interface PolicyCheckInput {
  readonly policy: NegotiationPolicy;
  readonly actor: NegotiationActor;
  readonly offer: number;
  readonly concessions: ReadonlyArray<NegotiationConcession>;
  readonly nowMs?: number; // injectable clock for tests
}

export type PolicyCheckOutcome =
  | {
      readonly kind: 'allow';
      readonly requiresAdvisor: false;
    }
  | {
      readonly kind: 'allow_with_advisor';
      readonly requiresAdvisor: true;
      readonly reason: string;
    }
  | {
      readonly kind: 'escalate';
      readonly requiresAdvisor: true;
      readonly reason: string;
      readonly violations: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'deny';
      readonly violations: ReadonlyArray<string>;
    };

/**
 * Pure function. No I/O, no randomness, no time access except via
 * `nowMs` injection.
 */
export function checkPolicy(input: PolicyCheckInput): PolicyCheckOutcome {
  const { policy, actor, offer, nowMs = Date.now() } = input;
  const violations: string[] = [];

  // 0. Policy must be active + unexpired.
  if (!policy.active) {
    violations.push('POLICY_INACTIVE');
  }
  if (
    policy.expiresAt &&
    Date.parse(policy.expiresAt as unknown as string) < nowMs
  ) {
    violations.push('POLICY_EXPIRED');
  }

  // 1. Non-finite or non-positive offers are invalid.
  if (!Number.isFinite(offer) || offer <= 0) {
    violations.push('INVALID_OFFER_AMOUNT');
    return { kind: 'deny', violations };
  }

  // 2. AI must never breach the hard floor.
  //    This is the single most important check — adversarial tests
  //    target it.
  if (actor === 'ai' && offer < policy.floorPrice) {
    violations.push('AI_FLOOR_BREACH');
    return { kind: 'deny', violations };
  }

  // 3. AI discount cap (belt-and-braces on floor).
  if (actor === 'ai' && policy.listPrice > 0 && policy.maxDiscountPct > 0) {
    const discountPct = (policy.listPrice - offer) / policy.listPrice;
    if (discountPct > policy.maxDiscountPct + 1e-9) {
      violations.push('AI_DISCOUNT_CAP_BREACH');
      return { kind: 'deny', violations };
    }
  }

  // 4. Soft gate — escalate when offer is below approvalRequiredBelow.
  //    Applies to AI-originated counters and any human proposal that
  //    crosses the gate while leaving the AI to respond.
  if (offer < policy.approvalRequiredBelow) {
    if (actor === 'ai') {
      violations.push('BELOW_APPROVAL_THRESHOLD');
      return {
        kind: 'escalate',
        requiresAdvisor: true,
        reason: `AI counter ${offer} < approvalRequiredBelow ${policy.approvalRequiredBelow}`,
        violations,
      };
    }
    // Owner/agent override — allow but flag for audit.
    if (actor === 'owner' || actor === 'agent') {
      return {
        kind: 'allow_with_advisor',
        requiresAdvisor: true,
        reason: `Human override below approvalRequiredBelow (${offer} < ${policy.approvalRequiredBelow})`,
      };
    }
  }

  // 5. Any earlier invariant violations that didn't short-circuit — deny.
  if (violations.length > 0) {
    return { kind: 'deny', violations };
  }

  return { kind: 'allow', requiresAdvisor: false };
}

/**
 * Convenience: returns true iff the outcome would block the turn from
 * being persisted at all. `allow_with_advisor` is permitted (routed
 * through advisor) but `escalate` pauses the turn pending human review.
 */
export function isBlocking(outcome: PolicyCheckOutcome): boolean {
  return outcome.kind === 'deny' || outcome.kind === 'escalate';
}

/**
 * Hard floor check extracted for use by LLM pre-flight prompts:
 * we never even ask the LLM to counter at/below the floor.
 */
export function computeAiCounterLowerBound(policy: NegotiationPolicy): number {
  return Math.max(policy.floorPrice, policy.approvalRequiredBelow);
}
