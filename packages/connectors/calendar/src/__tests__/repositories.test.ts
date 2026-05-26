import { describe, expect, it } from 'vitest';
import { createInMemoryCalendarEventsRepository } from '../repositories/messages.js';
import { createInMemoryCalendarCredentialsRepository } from '../repositories/credentials.js';
import { createInMemoryCursorRepository } from '../repositories/cursors.js';
import type { CalendarEvent, StoredCalendarCredentials } from '../types.js';

function buildEvent(eventId: string): CalendarEvent {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_id: 'tenant-001',
    provider: 'google_calendar',
    account: 'mwikila@example.com',
    calendar_id: 'primary',
    event_id: eventId,
    summary: 'meeting',
    description: null,
    start_at: '2026-06-01T09:00:00Z',
    end_at: '2026-06-01T10:00:00Z',
    attendees: [],
    raw: {},
    ingested_at: '2026-05-26T12:00:00.000Z',
    audit_hash: 'h',
  };
}

describe('Calendar repositories — in-memory round-trip', () => {
  it('events: dedup on (tenant, provider, account, calendar_id, event_id)', async () => {
    const repo = createInMemoryCalendarEventsRepository();
    const first = await repo.put(buildEvent('e-1'));
    const second = await repo.put(buildEvent('e-1'));
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });

  it('credentials: put + get + delete', async () => {
    const repo = createInMemoryCalendarCredentialsRepository();
    const creds: StoredCalendarCredentials = {
      tenant_id: 'tenant-001',
      connector_kind: 'google_calendar',
      connector_account: 'mwikila@example.com',
      access_token_enc: new Uint8Array([1, 2, 3]),
      refresh_token_enc: new Uint8Array([4, 5, 6]),
      scopes: ['calendar.readonly'],
      expires_at: '2026-06-26T00:00:00.000Z',
      audit_hash: 'h',
    };
    await repo.put(creds);
    const got = await repo.get({
      tenantId: 'tenant-001',
      provider: 'google_calendar',
      account: 'mwikila@example.com',
    });
    expect(got?.access_token_enc).toEqual(creds.access_token_enc);
    await repo.delete({
      tenantId: 'tenant-001',
      provider: 'google_calendar',
      account: 'mwikila@example.com',
    });
    expect(
      await repo.get({
        tenantId: 'tenant-001',
        provider: 'google_calendar',
        account: 'mwikila@example.com',
      }),
    ).toBeNull();
  });

  it('cursors: put + get with calendarId discrimination', async () => {
    const repo = createInMemoryCursorRepository();
    const key1 = {
      tenantId: 'tenant-001',
      provider: 'google_calendar' as const,
      account: 'mwikila@example.com',
      calendarId: 'primary',
    };
    const key2 = { ...key1, calendarId: 'site-sx12' };
    await repo.put(key1, 'sync-1');
    await repo.put(key2, 'sync-2');
    expect(await repo.get(key1)).toBe('sync-1');
    expect(await repo.get(key2)).toBe('sync-2');
  });
});
