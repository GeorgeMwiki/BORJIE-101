/**
 * Google Calendar provider — idempotent create-vs-update upsert.
 *
 * Proves the create→update decision keys on whether our deterministic event id
 * already exists (GET 404 → INSERT/events.insert; GET 200 → PATCH/events.patch),
 * asserts exact method + URL + body, and proves the retry path patches rather
 * than double-creating (the at-least-once dispatch guarantee).
 *
 * No real network: the CalendarFetcher seam is stubbed with vi.fn and a scripted
 * queue of responses, so we assert the EXACT HTTP shape the provider emits.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createGoogleCalendarProvider,
  deterministicGoogleEventId,
} from '../google-provider';
import type { CalendarEventInput, CalendarFetcher } from '../types';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

const ACCESS_TOKEN = 'ya29.test-access-token';

const baseInput: CalendarEventInput = {
  sourceId: 'reminder-42',
  summary: 'Licence renewal due',
  description: 'PML #ABC expires in 30 days',
  startIso: '2026-06-10T09:00:00.000Z',
  endIso: '2026-06-10T10:00:00.000Z',
  timeZone: 'Africa/Dar_es_Salaam',
  calendarId: 'primary',
};

interface StubResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
}

/**
 * A fetcher that returns scripted responses in order. Records every call so the
 * test can assert the exact method/URL/body sequence. Throws if the script is
 * exhausted (catches accidental extra HTTP calls).
 */
function scriptedFetcher(responses: readonly StubResponse[]): CalendarFetcher {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('scriptedFetcher: no scripted response left');
    }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json ?? {},
      text: async () => next.text ?? '',
    };
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

describe('deterministicGoogleEventId', () => {
  it('is a pure function of the source id (stable across calls)', () => {
    expect(deterministicGoogleEventId('reminder-42')).toBe(
      deterministicGoogleEventId('reminder-42'),
    );
  });

  it('differs for different source ids', () => {
    expect(deterministicGoogleEventId('a')).not.toBe(
      deterministicGoogleEventId('b'),
    );
  });

  it('only uses Google base32hex-legal chars [a-v0-9] within the length bound', () => {
    const id = deterministicGoogleEventId('reminder-42');
    // `borjie` prefix is itself in-charset; whole id must match base32hex.
    expect(id).toMatch(/^[a-v0-9]+$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });
});

describe('createGoogleCalendarProvider — create (events.insert)', () => {
  it('INSERTs when the event does not yet exist (GET 404 → POST)', async () => {
    const eventId = deterministicGoogleEventId(baseInput.sourceId);
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 }, // GET probe → not found
      { ok: true, status: 200, json: { id: eventId } }, // POST insert
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });

    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);

    expect(result).toEqual({
      status: 'created',
      provider: 'google',
      eventId,
    });

    const calls = (fetcher as FetchMock).mock.calls;
    expect(calls).toHaveLength(2);

    // 1) GET probe at the deterministic id.
    const [getUrl, getInit] = calls[0];
    expect(getUrl).toBe(
      `${GCAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    );
    expect(getInit.method).toBe('GET');
    expect(getInit.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    // 2) POST to the collection (events.insert) — NOT events/{id}.
    const [postUrl, postInit] = calls[1];
    expect(postUrl).toBe(`${GCAL_BASE}/calendars/primary/events`);
    expect(postInit.method).toBe('POST');
    expect(postInit.headers['Content-Type']).toBe('application/json');

    // Body carries our client-set id + the source-id provenance stamp.
    const body = JSON.parse(postInit.body as string);
    expect(body.id).toBe(eventId);
    expect(body.summary).toBe(baseInput.summary);
    expect(body.description).toBe(baseInput.description);
    expect(body.start).toEqual({
      dateTime: baseInput.startIso,
      timeZone: 'Africa/Dar_es_Salaam',
    });
    expect(body.end).toEqual({
      dateTime: baseInput.endIso,
      timeZone: 'Africa/Dar_es_Salaam',
    });
    expect(body.extendedProperties.private.borjieSourceId).toBe(
      baseInput.sourceId,
    );
    expect(body.extendedProperties.private.borjieManaged).toBe('true');
  });

  it('defaults timeZone to UTC and end to start + 30 min when omitted', async () => {
    const minimal: CalendarEventInput = {
      sourceId: 'item-7',
      summary: 'Shift',
      description: 'Pit B',
      startIso: '2026-06-10T09:00:00.000Z',
      calendarId: 'primary',
    };
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 },
      { ok: true, status: 200, json: {} },
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });

    await provider.upsertEvent(ACCESS_TOKEN, minimal);

    const postInit = (fetcher as FetchMock).mock.calls[1][1];
    const body = JSON.parse(postInit.body as string);
    expect(body.start.timeZone).toBe('UTC');
    expect(body.end.timeZone).toBe('UTC');
    // 09:00 + 30 min = 09:30
    expect(body.end.dateTime).toBe('2026-06-10T09:30:00.000Z');
  });

  it('url-encodes a non-default calendar id', async () => {
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 },
      { ok: true, status: 200, json: {} },
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });

    await provider.upsertEvent(ACCESS_TOKEN, {
      ...baseInput,
      calendarId: 'team cal@borjie.app',
    });

    const calls = (fetcher as FetchMock).mock.calls;
    const encodedCal = encodeURIComponent('team cal@borjie.app');
    expect(calls[0][0]).toContain(`/calendars/${encodedCal}/events/`);
    expect(calls[1][0]).toBe(`${GCAL_BASE}/calendars/${encodedCal}/events`);
  });
});

describe('createGoogleCalendarProvider — update (events.patch)', () => {
  it('PATCHes when the event already exists (GET 200 → PATCH), no insert', async () => {
    const eventId = deterministicGoogleEventId(baseInput.sourceId);
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { id: eventId } }, // GET probe → found
      { ok: true, status: 200, json: { id: eventId } }, // PATCH
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });

    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);

    expect(result).toEqual({
      status: 'updated',
      provider: 'google',
      eventId,
    });

    const calls = (fetcher as FetchMock).mock.calls;
    expect(calls).toHaveLength(2);

    // 2) PATCH targets events/{id} (NOT the collection) and OMITS the id field
    //    from the body (the id is immutable on patch).
    const [patchUrl, patchInit] = calls[1];
    expect(patchUrl).toBe(
      `${GCAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    );
    expect(patchInit.method).toBe('PATCH');
    const body = JSON.parse(patchInit.body as string);
    expect(body).not.toHaveProperty('id');
    expect(body.summary).toBe(baseInput.summary);

    // No call ever hit the bare collection endpoint (no insert happened).
    const hitCollection = calls.some(
      (c) => c[0] === `${GCAL_BASE}/calendars/primary/events` && c[1].method === 'POST',
    );
    expect(hitCollection).toBe(false);
  });
});

describe('createGoogleCalendarProvider — idempotency under retry', () => {
  it('same sourceId → same event id; a retry PATCHes, never a 2nd create', async () => {
    const eventId = deterministicGoogleEventId(baseInput.sourceId);

    // First dispatch: GET 404 → INSERT (created).
    const fetcher1 = scriptedFetcher([
      { ok: false, status: 404 },
      { ok: true, status: 200, json: { id: eventId } },
    ]);
    const provider1 = createGoogleCalendarProvider({ fetcher: fetcher1 });
    const first = await provider1.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(first.status).toBe('created');

    // Retry (same sourceId): the event now exists → GET 200 → PATCH (updated).
    const fetcher2 = scriptedFetcher([
      { ok: true, status: 200, json: { id: eventId } },
      { ok: true, status: 200, json: { id: eventId } },
    ]);
    const provider2 = createGoogleCalendarProvider({ fetcher: fetcher2 });
    const retry = await provider2.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(retry.status).toBe('updated');

    // Both targeted the IDENTICAL event id (idempotency key derived purely
    // from sourceId).
    if (first.status !== 'failed' && retry.status !== 'failed') {
      expect(first.eventId).toBe(retry.eventId);
      expect(retry.eventId).toBe(eventId);
    }

    // The retry made exactly ONE non-GET call, and it was a PATCH (no 2nd POST).
    const retryCalls = (fetcher2 as FetchMock).mock.calls;
    const mutating = retryCalls.filter((c) => c[1].method !== 'GET');
    expect(mutating).toHaveLength(1);
    expect(mutating[0][1].method).toBe('PATCH');
  });

  it('treats a 409 on insert (concurrent create) as an idempotent update', async () => {
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 }, // GET → not found at probe time
      { ok: false, status: 409 }, // POST raced a concurrent create
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });

    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('updated');
  });
});

describe('createGoogleCalendarProvider — failures', () => {
  it('maps a non-404 GET to a failure with the right retryable flag', async () => {
    const fetcher = scriptedFetcher([{ ok: false, status: 503, text: 'down' }]);
    const provider = createGoogleCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('google_get_503');
      expect(result.retryable).toBe(true);
    }
  });

  it('maps a 4xx insert to a non-retryable failure', async () => {
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 },
      { ok: false, status: 400, text: 'bad event' },
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('google_insert_400');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps a failing PATCH to a failure carrying the status', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: {} },
      { ok: false, status: 500, text: 'boom' },
    ]);
    const provider = createGoogleCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('google_patch_500');
      expect(result.retryable).toBe(true);
    }
  });

  it('returns a retryable network error when the fetcher throws', async () => {
    const fetcher: CalendarFetcher = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const provider = createGoogleCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('google_network_error');
      expect(result.retryable).toBe(true);
    }
  });
});
