/**
 * Rail-gate invariant tests — THE CONSTITUTIONAL CONTRACT.
 *
 * A violation here fails the lane. We prove:
 *   1. A rail GATE always forces requiresHumanApproval=true,
 *      autonomyEligible=false — REGARDLESS of the autonomy computation.
 *   2. The controller may only ADD gating, never remove it (monotone).
 *   3. A PASS verdict never loosens the candidate's own gating.
 *   4. Rail evidence is appended (never replaces) the candidate's chain.
 */
import { describe, expect, it } from 'vitest';
import { applyRailGate, isAutoActionable, RAIL_PASS } from '../rail-gate.js';
import { routeCapturedDatum, type RouteContext } from '../data-router.js';
import type { CapturedDatum, DataRoutingDecision } from '../routing-types.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const baseCtx: RouteContext = { now: () => NOW };

function confidentDatum(): CapturedDatum {
  return {
    id: 'doc_money',
    tenantId: 'tenant_a',
    kind: 'payment_receipt',
    classificationConfidence: 0.99,
    fields: { amount: { value: 100000, confidence: 0.99 } },
    capturedAt: NOW.toISOString(),
  };
}

describe('rail-gate ALWAYS wins', () => {
  it('forces gating on an otherwise auto-eligible decision', () => {
    // A perfectly confident, complete decision — would be auto-eligible.
    const auto = routeCapturedDatum(confidentDatum(), baseCtx);
    expect(auto.autonomyEligible).toBe(true);
    expect(auto.requiresHumanApproval).toBe(false);

    // Now route the SAME datum with a money rail GATE verdict.
    const gated = routeCapturedDatum(confidentDatum(), {
      ...baseCtx,
      railVerdict: {
        decision: 'GATE',
        railPrefix: 'money',
        reason: 'LedgerService money path is dual-control HITL',
      },
    });

    expect(gated.requiresHumanApproval).toBe(true);
    expect(gated.autonomyEligible).toBe(false);
    expect(isAutoActionable(gated)).toBe(false);
    expect(gated.rationale.code).toBe('rail_gated');
  });

  it.each(['sovereign', 'kill_switch', 'four_eye', 'policy_rollout'] as const)(
    'gates on HIGH-risk prefix %s regardless of confidence',
    (railPrefix) => {
      const d = routeCapturedDatum(confidentDatum(), {
        ...baseCtx,
        railVerdict: { decision: 'GATE', railPrefix },
      });
      expect(d.requiresHumanApproval).toBe(true);
      expect(d.autonomyEligible).toBe(false);
    },
  );
});

describe('applyRailGate is monotone (only ever tightens)', () => {
  const autoEligible: DataRoutingDecision = {
    datumId: 'd1',
    tenantId: 't',
    targetModule: 'finance',
    targetAction: 'post_receipt',
    rationale: {
      summary: 'ok',
      code: 'high_confidence_match',
      evidence: [{ kind: 'datum', id: 'd1' }],
      destinationConfidence: 0.99,
    },
    need: 'nothing',
    requiresHumanApproval: false,
    autonomyEligible: true,
    obligation: null,
    workflowHint: null,
    decidedAt: NOW.toISOString(),
  };

  it('GATE tightens an auto-eligible decision', () => {
    const out = applyRailGate(autoEligible, {
      decision: 'GATE',
      railPrefix: 'money',
    });
    expect(out.requiresHumanApproval).toBe(true);
    expect(out.autonomyEligible).toBe(false);
  });

  it('PASS NEVER loosens an already-gated decision', () => {
    const alreadyGated: DataRoutingDecision = {
      ...autoEligible,
      requiresHumanApproval: true,
      autonomyEligible: false,
    };
    const out = applyRailGate(alreadyGated, RAIL_PASS);
    // PASS must not flip the gating back open.
    expect(out.requiresHumanApproval).toBe(true);
    expect(out.autonomyEligible).toBe(false);
  });

  it('PASS leaves an auto-eligible decision unchanged', () => {
    const out = applyRailGate(autoEligible, RAIL_PASS);
    expect(out).toEqual(autoEligible);
  });

  it('appends rail evidence without dropping the candidate chain', () => {
    const out = applyRailGate(autoEligible, {
      decision: 'GATE',
      railPrefix: 'licence',
      reason: 'licence status is dual-control',
    });
    // Original datum evidence preserved + rail evidence appended.
    expect(out.rationale.evidence).toContainEqual({ kind: 'datum', id: 'd1' });
    expect(
      out.rationale.evidence.some((e) => e.id === 'rail:licence'),
    ).toBe(true);
  });
});
