/**
 * Routing → recommendation projector tests (the thin wire into the
 * existing proactive/tab-spawn surface).
 */
import { describe, expect, it } from 'vitest';
import { recommendationFromRouting } from '../routing-recommendation.js';
import { routeCapturedDatum, type RouteContext } from '../data-router.js';
import type { CapturedDatum } from '../routing-types.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const ctx: RouteContext = { now: () => NOW };

function datum(over: Partial<CapturedDatum> = {}): CapturedDatum {
  return {
    id: 'doc_1',
    tenantId: 'tenant_a',
    kind: 'national_id',
    classificationConfidence: 0.95,
    fields: { id_number: { value: 'NID', confidence: 0.95 } },
    capturedAt: NOW.toISOString(),
    ...over,
  };
}

describe('recommendationFromRouting', () => {
  it('produces NO recommendation for a clean file-and-forget decision', () => {
    const d = routeCapturedDatum(datum(), ctx);
    expect(d.need).toBe('nothing');
    expect(d.requiresHumanApproval).toBe(false);
    expect(recommendationFromRouting(d)).toBeNull();
  });

  it('produces an approval recommendation for a gated decision', () => {
    const d = routeCapturedDatum(datum({ classificationConfidence: 0.4 }), ctx);
    const rec = recommendationFromRouting(d);
    expect(rec).not.toBeNull();
    expect(rec?.type).toBe('anomaly');
    expect(rec?.agUiPart.kind).toBe('ag-ui.ApprovalDialog.v1');
    expect(rec?.agUiPart.correlationId).toBe('route:doc_1');
    expect(rec?.sourceEventId).toBe('doc_1');
  });

  it('uses compliance-deadline-near kind for dated obligations', () => {
    const d = routeCapturedDatum(
      {
        id: 'inv_1',
        tenantId: 'tenant_a',
        kind: 'vendor_invoice',
        classificationConfidence: 0.95,
        fields: {
          vendor_name: { value: 'Acme', confidence: 0.95 },
          amount: { value: 5000, confidence: 0.95 },
          due_date: {
            value: '2026-06-12',
            confidence: 0.95,
            isoDate: '2026-06-12T00:00:00Z',
          },
        },
        capturedAt: NOW.toISOString(),
      },
      ctx,
    );
    const rec = recommendationFromRouting(d);
    expect(rec?.kind).toBe('compliance-deadline-near');
    expect(rec?.severity).toBe('P0'); // 4 days → P1 boundary check
  });

  it('maps platform-internal scope when tenantId is null', () => {
    const d = routeCapturedDatum(
      datum({ tenantId: null, classificationConfidence: 0.4 }),
      ctx,
    );
    const rec = recommendationFromRouting(d);
    expect(rec?.scope).toBe('platform-internal');
    expect(rec?.tenantId).toBeNull();
  });

  it('surfaces a workflow decision as a start-workflow recommendation', () => {
    const d = routeCapturedDatum(
      {
        id: 'lic_1',
        tenantId: 'tenant_a',
        kind: 'licence_renewal',
        classificationConfidence: 0.95,
        fields: { licence_reference: { value: 'LIC', confidence: 0.95 } },
        capturedAt: NOW.toISOString(),
      },
      ctx,
    );
    const rec = recommendationFromRouting(d);
    expect(rec).not.toBeNull();
    expect(rec?.agUiPart.approveLabel).toBe('Start workflow');
  });
});
