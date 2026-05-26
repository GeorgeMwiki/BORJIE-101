import { describe, expect, it } from 'vitest';
import { createCalendarNormaliser } from '../ingest/normalizer.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import type { Hasher } from '../types.js';
import {
  GOOGLE_EVENTS_OK_PAYLOAD,
  OUTLOOK_EVENTS_OK_PAYLOAD,
} from './fixtures/calendar-fixtures.js';

function det(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `t-${h.toString(16).padStart(8, '0')}`;
  };
}

function buildNormaliser() {
  let n = 0;
  return createCalendarNormaliser({
    redactor: createPiiRedactor({ hasher: det() }),
    clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
    uuid: {
      v4: () => {
        n += 1;
        return `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
      },
    },
  });
}

describe('Calendar normaliser', () => {
  it('normalises Google events with attendee email hashing', async () => {
    const normaliser = buildNormaliser();
    const ev = GOOGLE_EVENTS_OK_PAYLOAD.items[0];
    if (ev === undefined) throw new Error('fixture missing event');
    const result = await normaliser.normaliseGoogle({
      tenantId: 'tenant-001',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      event: ev,
      auditHash: 'h',
    });
    expect(result.provider).toBe('google_calendar');
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees[0]?.email_hash).toMatch(/^\[email:/);
    expect(result.description).not.toContain('mwikila@example.com');
    expect(result.start_at).toBe('2026-06-01T09:00:00Z');
  });

  it('normalises Outlook events and strips embedded auth tokens', async () => {
    const normaliser = buildNormaliser();
    const ev = OUTLOOK_EVENTS_OK_PAYLOAD.value[0];
    if (ev === undefined) throw new Error('fixture missing event');
    const result = await normaliser.normaliseOutlook({
      tenantId: 'tenant-001',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      event: ev,
      auditHash: 'h',
    });
    expect(result.provider).toBe('outlook_calendar');
    expect(result.description).not.toContain('topsecret');
  });

  it('bakes originalStartTime into Google event_id for recurring instances', async () => {
    const normaliser = buildNormaliser();
    const result = await normaliser.normaliseGoogle({
      tenantId: 'tenant-001',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      event: {
        id: 'recurring-001',
        status: 'confirmed',
        start: { dateTime: '2026-06-01T09:00:00Z' },
        end: { dateTime: '2026-06-01T10:00:00Z' },
        originalStartTime: { dateTime: '2026-06-01T09:00:00Z' },
      },
      auditHash: 'h',
    });
    expect(result.event_id).toBe('recurring-001@2026-06-01T09:00:00Z');
  });
});
