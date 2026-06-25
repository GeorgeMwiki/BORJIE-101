import { describe, expect, it } from 'vitest';

import {
  COCKPIT_EVENT_KINDS,
  describeCockpitEvent,
  parseCockpitEvent,
  type CockpitEvent,
} from '../cockpit-sse';

const SAMPLE_TENANT = '11111111-2222-3333-4444-555555555555';

function decisionEvent(): CockpitEvent {
  return {
    kind: 'decision.recorded',
    tenantId: SAMPLE_TENANT,
    emittedAt: '2026-05-29T10:00:00Z',
    decisionId: 'dec-xyz',
    subject: 'Quarterly licence renewal',
    severity: 'high',
  };
}

/**
 * The owner-relevant subset of the gateway's emitted cockpit event kinds.
 *
 * MIRRORS `services/api-gateway/src/services/cockpit-events/types.ts`
 * `COCKPIT_EVENT_KINDS`, MINUS the kinds whose `tenantId` channel targets
 * ONLY a non-owner actor (buyer-mobile / cooperative / worker-mobile). Those
 * intra-tenant kinds still land on the shared `cockpit:<tenantId>` channel,
 * but the owner cockpit has no surface for them, so the allowlist need not —
 * and intentionally does not — enumerate every wire kind. It MUST, however,
 * be a SUPERSET of THIS set: every kind here is a pulse the owner must render.
 *
 * The contract test below fails if a NEW owner-targeted gateway kind is added
 * without a matching owner-web describer — i.e. the owner would silently drop
 * a live pulse the gateway pushes.
 */
const GATEWAY_OWNER_TARGETED_KINDS = [
  'decision.recorded',
  'reminder.fired',
  'opportunity.scan_completed',
  'risk.changed',
  'workforce.shift_event',
  'compliance.deadline_approaching',
  'production.posted',
  'safety.incident_reported',
  'incident.escalated',
  'bid.placed',
  'bid.accepted',
  'bid.rejected',
  'payroll.committed',
  'mwikila.acted',
  'mwikila.proposes',
  'regulator.request_received',
  'task.assigned',
  'settlement.initiated',
  'licence.renewal_status_changed',
  'cockpit.tab.spawned',
  'cockpit.tab.updated',
  'cockpit.tab.removed',
  'cockpit.tab.proposed',
] as const;

describe('cockpit-sse — kinds catalog', () => {
  it('is a SUPERSET of the gateway owner-targeted kinds (no dropped pulse)', () => {
    const allow = new Set<string>(COCKPIT_EVENT_KINDS);
    const missing = GATEWAY_OWNER_TARGETED_KINDS.filter((k) => !allow.has(k));
    // A non-empty diff means the gateway pushes a kind the owner cockpit has
    // no listener / describer for — the owner silently drops it.
    expect(missing).toEqual([]);
  });

  it('still carries the original R6 + L6 + CT-5 kinds', () => {
    for (const k of [
      'decision.recorded',
      'reminder.fired',
      'opportunity.scan_completed',
      'risk.changed',
      'workforce.shift_event',
      'compliance.deadline_approaching',
      'production.posted',
      'cockpit.tab.spawned',
      'cockpit.tab.updated',
      'cockpit.tab.removed',
      'cockpit.tab.proposed',
    ]) {
      expect(COCKPIT_EVENT_KINDS).toContain(k);
    }
  });
});

describe('cockpit-sse — parser', () => {
  it('parses a well-formed decision event', () => {
    const json = JSON.stringify(decisionEvent());
    const out = parseCockpitEvent(json);
    expect(out).not.toBeNull();
    expect(out?.kind).toBe('decision.recorded');
    expect(out?.tenantId).toBe(SAMPLE_TENANT);
  });

  it('rejects malformed JSON', () => {
    expect(parseCockpitEvent('not-json{{')).toBeNull();
  });

  it('rejects an unknown event kind', () => {
    const out = parseCockpitEvent(
      JSON.stringify({
        kind: 'unknown.something',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
      }),
    );
    expect(out).toBeNull();
  });

  it('rejects an event missing tenantId', () => {
    const out = parseCockpitEvent(
      JSON.stringify({
        kind: 'reminder.fired',
        emittedAt: '2026-05-29T10:00:00Z',
      }),
    );
    expect(out).toBeNull();
  });

  it('rejects an event with non-string emittedAt', () => {
    const out = parseCockpitEvent(
      JSON.stringify({
        kind: 'reminder.fired',
        tenantId: SAMPLE_TENANT,
        emittedAt: 42,
      }),
    );
    expect(out).toBeNull();
  });
});

describe('cockpit-sse — bilingual describer', () => {
  it('renders English copy by default', () => {
    const text = describeCockpitEvent(decisionEvent());
    expect(text).toContain('high decision');
    expect(text).toContain('Quarterly licence renewal');
  });

  it('renders Swahili copy when asked', () => {
    const text = describeCockpitEvent(decisionEvent(), 'sw');
    expect(text).toContain('Uamuzi mpya');
    expect(text).toContain('Quarterly licence renewal');
  });

  it('handles every event kind without throwing', () => {
    const events: CockpitEvent[] = [
      decisionEvent(),
      {
        kind: 'reminder.fired',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        reminderId: 'r-1',
        title: 'Pay TRA',
        channel: 'sms',
      },
      {
        kind: 'opportunity.scan_completed',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        opportunityCount: 3,
        topExpectedValueTzs: 12_000_000,
      },
      {
        kind: 'risk.changed',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        riskId: 'risk-1',
        severity: 'high',
        previousSeverity: 'medium',
      },
      {
        kind: 'workforce.shift_event',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        workerId: 'w-1',
        transition: 'shift_start',
      },
      {
        kind: 'compliance.deadline_approaching',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        filingId: 'f-1',
        filingKind: 'TRA_VAT',
        dueAt: '2026-06-05T10:00:00Z',
        daysRemaining: 7,
      },
      {
        kind: 'production.posted',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        shiftReportId: 'sr-1',
        siteId: 'site-a',
        shiftDate: '2026-05-29',
        romTonnes: 120,
        metresAdvanced: 8,
        bcmOverburden: 200,
        fuelLitres: 450,
      },
    ];
    for (const e of events) {
      expect(() => describeCockpitEvent(e, 'en')).not.toThrow();
      expect(() => describeCockpitEvent(e, 'sw')).not.toThrow();
    }
  });

  it('describes every NEW owner-targeted kind in both locales', () => {
    const newEvents: CockpitEvent[] = [
      {
        kind: 'safety.incident_reported',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        incidentId: 'inc-1',
        siteId: 'site-a',
        severity: 'high',
        reportedBy: 'w-1',
        summary: 'Rockfall near shaft 3',
      },
      {
        kind: 'incident.escalated',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        incidentId: 'inc-1',
        fromLevel: 'manager',
        toLevel: 'owner',
        escalatedBy: 'm-1',
      },
      {
        kind: 'bid.placed',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        bidId: 'bid-1',
        parcelId: 'lst-1',
        amountTzs: 5_000_000,
        bidderId: 'buy-1',
      },
      {
        kind: 'bid.accepted',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        bidId: 'bid-1',
        listingId: 'lst-1',
        offtakeAgreementId: 'oa-1',
        buyerId: 'buy-1',
      },
      {
        kind: 'bid.rejected',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        bidId: 'bid-1',
        listingId: 'lst-1',
        buyerId: 'buy-1',
      },
      {
        kind: 'payroll.committed',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        payrollRunId: 'pr-1',
        periodEnd: '2026-05-31',
        netTotalTzs: 12_000_000,
        headcount: 14,
        committedBy: 'o-1',
      },
      {
        kind: 'mwikila.acted',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        actionId: 'act-1',
        actionKind: 'reorder_consumable',
        category: 'procurement',
        delegationTier: 'T2',
        summary: 'Reordered ANFO',
      },
      {
        kind: 'mwikila.proposes',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        actionId: 'act-2',
        actionKind: 'renew_licence',
        category: 'compliance',
        delegationTier: 'T1',
        summary: 'Renew PML 12345',
      },
      {
        kind: 'regulator.request_received',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        requestId: 'req-1',
        regulator: 'nemc',
        subjectKind: 'eia',
        dueAt: '2026-06-10T00:00:00Z',
        summaryEn: 'EIA addendum requested',
        summarySw: 'Nyongeza ya EIA imeombwa',
      },
      {
        kind: 'task.assigned',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        taskId: 't-1',
        assigneeId: 'w-1',
        assignedBy: 'm-1',
        title: 'Inspect crusher',
        siteId: 'site-a',
        priority: 'high',
      },
      {
        kind: 'settlement.initiated',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        settlementId: 's-1',
        cooperativeId: null,
        amountTzs: 3_000_000,
        initiatedBy: 'o-1',
      },
      {
        kind: 'licence.renewal_status_changed',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        licenceId: 'lic-1',
        licenceEventId: 'le-1',
        fromStatus: 'submitted',
        toStatus: 'acknowledged',
        daysUntilExpiry: 30,
      },
    ];
    for (const e of newEvents) {
      const en = describeCockpitEvent(e, 'en');
      const sw = describeCockpitEvent(e, 'sw');
      // Every kind resolves to real copy — never the bare kind-token fallback.
      expect(en).not.toBe(e.kind);
      expect(sw).not.toBe(e.kind);
      expect(en.length).toBeGreaterThan(0);
      expect(sw.length).toBeGreaterThan(0);
    }
  });

  it('renders production.posted with the live ROM tonnes', () => {
    const event: CockpitEvent = {
      kind: 'production.posted',
      tenantId: SAMPLE_TENANT,
      emittedAt: '2026-05-29T10:00:00Z',
      shiftReportId: 'sr-9',
      siteId: 'site-x',
      shiftDate: '2026-05-29',
      romTonnes: 75,
      metresAdvanced: null,
      bcmOverburden: null,
      fuelLitres: null,
    };
    expect(describeCockpitEvent(event, 'en')).toContain('75t ROM');
    expect(describeCockpitEvent(event, 'sw')).toContain('Moja kwa moja');
  });

  it('parses a production.posted event from JSON', () => {
    const out = parseCockpitEvent(
      JSON.stringify({
        kind: 'production.posted',
        tenantId: SAMPLE_TENANT,
        emittedAt: '2026-05-29T10:00:00Z',
        shiftReportId: 'sr-9',
        siteId: 'site-x',
        shiftDate: '2026-05-29',
        romTonnes: 75,
        metresAdvanced: null,
        bcmOverburden: null,
        fuelLitres: null,
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe('production.posted');
  });
});
