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

describe('cockpit-sse — kinds catalog', () => {
  it('lists all R6 + L6 + CT-5 cockpit event kinds', () => {
    expect(COCKPIT_EVENT_KINDS).toEqual([
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
    ]);
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
