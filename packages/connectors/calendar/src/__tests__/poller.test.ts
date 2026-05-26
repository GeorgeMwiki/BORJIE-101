import { describe, expect, it } from 'vitest';
import { createGoogleCalendarClient } from '../client/google-cal-api.js';
import { createOutlookCalendarClient } from '../client/outlook-graph.js';
import { createCalendarNormaliser } from '../ingest/normalizer.js';
import { createCalendarPoller } from '../ingest/poller.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import { createInMemoryCalendarEventsRepository } from '../repositories/messages.js';
import {
  GOOGLE_EVENTS_OK_PAYLOAD,
  OUTLOOK_EVENTS_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/calendar-fixtures.js';
import type { Hasher } from '../types.js';

function det(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `t-${h.toString(16).padStart(8, '0')}`;
  };
}

function buildPoller(responses: ReadonlyArray<ReturnType<typeof buildFetcherResponse>>) {
  const { fetcher } = createCannedFetcher(responses);
  const hasher = det();
  return {
    poller: createCalendarPoller({
      google: createGoogleCalendarClient({ fetcher }),
      outlook: createOutlookCalendarClient({ fetcher }),
      normaliser: createCalendarNormaliser({
        redactor: createPiiRedactor({ hasher }),
        clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
        uuid: {
          v4: (() => {
            let n = 0;
            return () => {
              n += 1;
              return `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
            };
          })(),
        },
      }),
      hasher,
      maxRetries: 1,
      baseBackoffMs: 1,
      windowStartIso: '2026-05-01T00:00:00Z',
      windowEndIso: '2026-07-01T00:00:00Z',
    }),
  };
}

describe('Calendar poller', () => {
  it('ingests Google events and dedups on second run', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse(GOOGLE_EVENTS_OK_PAYLOAD),
      buildFetcherResponse(GOOGLE_EVENTS_OK_PAYLOAD),
    ]);
    const repo = createInMemoryCalendarEventsRepository();
    const req = {
      tenantId: 'tenant-001',
      provider: 'google_calendar' as const,
      account: 'mwikila@example.com',
      calendarId: 'primary',
      cursor: null,
      maxItems: 50,
      accessToken: 'ya29-test',
    };

    const first = await poller.poll(req);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error('unreachable');
    for (const e of first.events) await repo.put(e);
    expect((await repo.listByTenant('tenant-001')).length).toBe(1);

    const second = await poller.poll(req);
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw new Error('unreachable');
    let inserted = 0;
    for (const e of second.events) {
      const r = await repo.put(e);
      if (r.inserted) inserted += 1;
    }
    expect(inserted).toBe(0);
  });

  it('ingests Outlook events', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse(OUTLOOK_EVENTS_OK_PAYLOAD),
    ]);
    const result = await poller.poll({
      tenantId: 'tenant-001',
      provider: 'outlook_calendar',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      cursor: null,
      maxItems: 50,
      accessToken: 'ms-test',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.provider).toBe('outlook_calendar');
    }
  });

  it('surfaces sync-token-reset on Google 410 Gone', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse({}, { status: 410 }),
    ]);
    const result = await poller.poll({
      tenantId: 'tenant-001',
      provider: 'google_calendar',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      cursor: 'expired-sync-token',
      maxItems: 50,
      accessToken: 'ya29-test',
    });
    expect(result.kind).toBe('sync-token-reset');
  });

  it('surfaces 429 from Outlook as rate-limited', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse({}, { status: 429, headers: { 'retry-after': '7' } }),
    ]);
    const result = await poller.poll({
      tenantId: 'tenant-001',
      provider: 'outlook_calendar',
      account: 'mwikila@example.com',
      calendarId: 'primary',
      cursor: null,
      maxItems: 50,
      accessToken: 'ms-test',
    });
    expect(result.kind).toBe('rate-limited');
    if (result.kind === 'rate-limited') {
      expect(result.retryAfterMs).toBe(7000);
    }
  });
});
