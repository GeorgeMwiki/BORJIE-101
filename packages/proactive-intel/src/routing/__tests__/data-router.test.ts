/**
 * Data-routing reasoner tests.
 *
 * Covers WHERE/WHY/WHAT-NEXT + the constitutional rail-gate-always-wins
 * invariant (a violation of which fails the lane).
 */
import { describe, expect, it } from 'vitest';
import {
  routeCapturedDatum,
  DEFAULT_AUTO_APPLY_THRESHOLD,
  type RouteContext,
} from '../data-router.js';
import type { CapturedDatum } from '../routing-types.js';
import { isAutoActionable } from '../rail-gate.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  now: () => NOW,
  ...over,
});

function datum(over: Partial<CapturedDatum> = {}): CapturedDatum {
  return {
    id: 'doc_1',
    tenantId: 'tenant_a',
    kind: 'payment_receipt',
    classificationConfidence: 0.95,
    fields: { amount: { value: 100000, confidence: 0.95 } },
    capturedAt: NOW.toISOString(),
    ...over,
  };
}

describe('routeCapturedDatum — WHERE', () => {
  it('routes a confident payment receipt to finance.post_receipt', () => {
    const d = routeCapturedDatum(datum(), ctx());
    expect(d.targetModule).toBe('finance');
    expect(d.targetAction).toBe('post_receipt');
    expect(d.rationale.code).toBe('high_confidence_match');
  });

  it('routes an unknown kind to triage, gated, with non-empty evidence', () => {
    const d = routeCapturedDatum(datum({ kind: 'mystery_thing' }), ctx());
    expect(d.targetModule).toBe('unknown');
    expect(d.targetAction).toBe('triage');
    expect(d.requiresHumanApproval).toBe(true);
    expect(d.autonomyEligible).toBe(false);
    expect(d.rationale.evidence.length).toBeGreaterThan(0);
  });

  it('honours host destinations over built-ins', () => {
    const d = routeCapturedDatum(
      datum({ kind: 'custom', fields: { ref: { value: 'x', confidence: 1 } } }),
      ctx({
        destinations: [
          {
            kind: 'custom',
            module: 'treasury',
            action: 'do_thing',
            requiredFieldKeys: ['ref'],
          },
        ],
      }),
    );
    expect(d.targetModule).toBe('treasury');
    expect(d.targetAction).toBe('do_thing');
  });
});

describe('routeCapturedDatum — WHY + gating', () => {
  it('gates when a required field is missing', () => {
    const d = routeCapturedDatum(
      datum({ fields: {} }), // amount missing
      ctx(),
    );
    expect(d.rationale.code).toBe('required_field_missing');
    expect(d.requiresHumanApproval).toBe(true);
    expect(d.autonomyEligible).toBe(false);
  });

  it('gates when combined confidence is below the auto-apply threshold', () => {
    const d = routeCapturedDatum(
      datum({ classificationConfidence: 0.5 }),
      ctx(),
    );
    expect(d.rationale.destinationConfidence).toBeLessThan(
      DEFAULT_AUTO_APPLY_THRESHOLD,
    );
    expect(d.rationale.code).toBe('low_confidence_match');
    expect(d.requiresHumanApproval).toBe(true);
  });

  it('is autonomy-eligible when confident, complete, and not rail-gated', () => {
    const d = routeCapturedDatum(datum(), ctx());
    expect(d.requiresHumanApproval).toBe(false);
    expect(d.autonomyEligible).toBe(true);
    expect(isAutoActionable(d)).toBe(true);
  });

  it('always cites at least one evidence pointer', () => {
    const d = routeCapturedDatum(datum(), ctx());
    expect(d.rationale.evidence.length).toBeGreaterThanOrEqual(1);
    expect(d.rationale.evidence.some((e) => e.kind === 'datum')).toBe(true);
  });
});

describe('routeCapturedDatum — WHAT NEXT (need judgement)', () => {
  it('file-and-forget for a non-dated, non-workflow datum', () => {
    const d = routeCapturedDatum(
      datum({
        kind: 'national_id',
        fields: { id_number: { value: 'NID-1', confidence: 0.95 } },
      }),
      ctx(),
    );
    expect(d.need).toBe('nothing');
    expect(d.obligation).toBeNull();
    expect(d.workflowHint).toBeNull();
  });

  it('emits a follow-up for a dated obligation due within 30 days', () => {
    const d = routeCapturedDatum(
      datum({
        kind: 'vendor_invoice',
        fields: {
          vendor_name: { value: 'Acme', confidence: 0.95 },
          amount: { value: 5000, confidence: 0.95 },
          due_date: {
            value: '2026-06-20',
            confidence: 0.95,
            isoDate: '2026-06-20T00:00:00Z',
          },
        },
      }),
      ctx(),
    );
    expect(d.need).toBe('follow-up');
    expect(d.obligation).not.toBeNull();
    expect(d.obligation?.daysUntilDue).toBe(11);
    expect(d.rationale.code).toBe('dated_obligation');
  });

  it('emits a reminder for a dated obligation further than 30 days out', () => {
    const d = routeCapturedDatum(
      datum({
        kind: 'vendor_invoice',
        fields: {
          vendor_name: { value: 'Acme', confidence: 0.95 },
          amount: { value: 5000, confidence: 0.95 },
          due_date: {
            value: '2026-09-01',
            confidence: 0.95,
            isoDate: '2026-09-01T00:00:00Z',
          },
        },
      }),
      ctx(),
    );
    expect(d.need).toBe('reminder');
    expect(d.obligation?.daysUntilDue).toBeGreaterThan(30);
  });

  it('emits a workflow need with a hint for workflow-kinds', () => {
    const d = routeCapturedDatum(
      datum({
        kind: 'licence_renewal',
        fields: {
          licence_reference: { value: 'LIC-4471', confidence: 0.95 },
        },
      }),
      ctx(),
    );
    expect(d.need).toBe('workflow');
    expect(d.workflowHint).toBe('licence_renewal');
  });

  it('marks an overdue obligation with negative daysUntilDue', () => {
    const d = routeCapturedDatum(
      datum({
        kind: 'royalty_return',
        fields: {
          amount: { value: 999, confidence: 0.95 },
          due_date: {
            value: '2026-06-01',
            confidence: 0.95,
            isoDate: '2026-06-01T00:00:00Z',
          },
        },
      }),
      ctx(),
    );
    // royalty_return has a workflowHint, so need is 'workflow', but the
    // obligation is still extracted.
    expect(d.obligation?.daysUntilDue).toBeLessThan(0);
  });

  it('is deterministic — same inputs yield same decision', () => {
    const a = routeCapturedDatum(datum(), ctx());
    const b = routeCapturedDatum(datum(), ctx());
    expect(a).toEqual(b);
  });
});
