/**
 * Follow-up bridge tests — the doc→follow-up join.
 */
import { describe, expect, it } from 'vitest';
import { followupFromRouting } from '../followup-bridge.js';
import { routeCapturedDatum, type RouteContext } from '../data-router.js';
import type { CapturedDatum, DataRoutingDecision } from '../routing-types.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const routeCtx: RouteContext = { now: () => NOW };
const bridgeCtx = { now: () => NOW };

function datedDatum(dueIso: string): CapturedDatum {
  return {
    id: 'inv_1',
    tenantId: 'tenant_a',
    kind: 'vendor_invoice',
    classificationConfidence: 0.95,
    fields: {
      vendor_name: { value: 'Acme', confidence: 0.95 },
      amount: { value: 5000, confidence: 0.95 },
      due_date: { value: dueIso, confidence: 0.95, isoDate: dueIso },
    },
    capturedAt: NOW.toISOString(),
  };
}

describe('followupFromRouting', () => {
  it('emits a seed for a dated follow-up decision', () => {
    const decision = routeCapturedDatum(
      datedDatum('2026-06-20T00:00:00Z'),
      routeCtx,
    );
    const seed = followupFromRouting(decision, bridgeCtx);
    expect(seed).not.toBeNull();
    expect(seed?.source).toBe('anticipatory');
    expect(seed?.tenantId).toBe('tenant_a');
    expect(seed?.priority).toBeGreaterThan(0);
    expect(seed?.priority).toBeLessThanOrEqual(1);
    expect(seed?.channel).toBe('inapp'); // chat-first default
    expect(seed?.evidence.length).toBeGreaterThan(0);
  });

  it('returns null when the decision is a workflow (no follow-up here)', () => {
    const decision = routeCapturedDatum(
      {
        id: 'lic_1',
        tenantId: 'tenant_a',
        kind: 'licence_renewal',
        classificationConfidence: 0.95,
        fields: { licence_reference: { value: 'LIC', confidence: 0.95 } },
        capturedAt: NOW.toISOString(),
      },
      routeCtx,
    );
    expect(decision.need).toBe('workflow');
    expect(followupFromRouting(decision, bridgeCtx)).toBeNull();
  });

  it('returns null for a file-and-forget decision', () => {
    const decision = routeCapturedDatum(
      {
        id: 'nid_1',
        tenantId: 'tenant_a',
        kind: 'national_id',
        classificationConfidence: 0.95,
        fields: { id_number: { value: 'NID', confidence: 0.95 } },
        capturedAt: NOW.toISOString(),
      },
      routeCtx,
    );
    expect(decision.need).toBe('nothing');
    expect(followupFromRouting(decision, bridgeCtx)).toBeNull();
  });

  it('flags critical=true when the obligation is within 3 days', () => {
    const decision = routeCapturedDatum(
      datedDatum('2026-06-10T00:00:00Z'), // 2 days out
      routeCtx,
    );
    const seed = followupFromRouting(decision, bridgeCtx);
    expect(seed?.critical).toBe(true);
  });

  it('overdue obligation pegs priority to 1', () => {
    const decision = routeCapturedDatum(
      datedDatum('2026-06-01T00:00:00Z'), // overdue
      routeCtx,
    );
    const seed = followupFromRouting(decision, bridgeCtx);
    expect(seed?.priority).toBe(1);
  });

  it('never schedules in the past', () => {
    const decision = routeCapturedDatum(
      datedDatum('2026-06-09T00:00:00Z'), // 1 day out; lead 7 → would be past
      routeCtx,
    );
    const seed = followupFromRouting(decision, bridgeCtx);
    expect(Date.parse(seed!.scheduledFor)).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
  });

  it('forwards gating: a gated decision asks for approval, not review', () => {
    const gated: DataRoutingDecision = {
      ...routeCapturedDatum(datedDatum('2026-06-20T00:00:00Z'), routeCtx),
      requiresHumanApproval: true,
      autonomyEligible: false,
    };
    const seed = followupFromRouting(gated, bridgeCtx);
    expect(seed?.action).toBe('approve');
    expect(seed?.requiresHumanApproval).toBe(true);
  });
});
