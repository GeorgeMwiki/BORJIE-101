/**
 * Microsoft 365 (Graph) calendar provider — idempotent create-vs-update upsert.
 *
 * Graph forbids client-set event ids, so idempotency keys on a custom
 * singleValueExtendedProperty stamped with our sourceId:
 *   - list query finds a stamped event → PATCH /me/events/{id}  → 'updated'
 *   - no hit                           → POST /me/events        → 'created'
 *
 * Proves the create/update choice, exact method/URL/body (POST carries the
 * transactionId idempotency token + the extended-property stamp; PATCH drops the
 * immutable transactionId and targets the resolved id), and the retry path.
 *
 * No real network: the CalendarFetcher seam is stubbed with vi.fn.
 */

import { describe, it, expect, vi } from 'vitest';

import { createMicrosoftCalendarProvider } from '../microsoft-provider';
import type { CalendarEventInput, CalendarFetcher } from '../types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const EXT_PROP_ID =
  'String {b6e6f3a0-1c2d-4e5f-9a8b-0c1d2e3f4a5b} Name borjieSourceId';

const ACCESS_TOKEN = 'eyJ0.test-graph-token';

const baseInput: CalendarEventInput = {
  sourceId: 'reminder-99',
  summary: 'Royalty payment deadline',
  description: 'TMAA royalty due',
  startIso: '2026-07-01T08:00:00.000Z',
  endIso: '2026-07-01T08:45:00.000Z',
  timeZone: 'Africa/Dar_es_Salaam',
  calendarId: 'primary',
};

interface StubResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
}

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

describe('createMicrosoftCalendarProvider — create (POST /me/events)', () => {
  it('POSTs a new event when the list query finds no stamped event', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } }, // list → empty
      { ok: true, status: 201, json: { id: 'AAMkAGI-graph-id' } }, // POST
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });

    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);

    expect(result).toEqual({
      status: 'created',
      provider: 'microsoft',
      eventId: 'AAMkAGI-graph-id',
    });

    const calls = (fetcher as FetchMock).mock.calls;
    expect(calls).toHaveLength(2);

    // 1) GET list filters on our extended property == sourceId.
    const [listUrl, listInit] = calls[0];
    expect(listUrl).toContain(`${GRAPH_BASE}/me/events?`);
    expect(listUrl).toContain('$select=id');
    expect(listUrl).toContain('$top=1');
    // The filter (url-encoded) names our prop id + the source id.
    const decoded = decodeURIComponent(listUrl as string);
    expect(decoded).toContain(`ep/id eq '${EXT_PROP_ID}'`);
    expect(decoded).toContain(`ep/value eq '${baseInput.sourceId}'`);
    expect(listInit.method).toBe('GET');
    expect(listInit.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    // 2) POST to the collection (create).
    const [postUrl, postInit] = calls[1];
    expect(postUrl).toBe(`${GRAPH_BASE}/me/events`);
    expect(postInit.method).toBe('POST');
    expect(postInit.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(postInit.body as string);
    expect(body.subject).toBe(baseInput.summary);
    expect(body.body).toEqual({
      contentType: 'HTML',
      content: baseInput.description,
    });
    expect(body.start).toEqual({
      dateTime: baseInput.startIso,
      timeZone: 'Africa/Dar_es_Salaam',
    });
    expect(body.end).toEqual({
      dateTime: baseInput.endIso,
      timeZone: 'Africa/Dar_es_Salaam',
    });
    // transactionId == sourceId is the Graph create-retry idempotency token.
    expect(body.transactionId).toBe(baseInput.sourceId);
    // The idempotency stamp is present so a future upsert can find this event.
    expect(body.singleValueExtendedProperties).toEqual([
      { id: EXT_PROP_ID, value: baseInput.sourceId },
    ]);
  });

  it('falls back eventId to sourceId when the create response omits id', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } },
      { ok: true, status: 201, json: {} }, // no id field
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.eventId).toBe(baseInput.sourceId);
    }
  });

  it('defaults timeZone to UTC and end to start + 30 min when omitted', async () => {
    const minimal: CalendarEventInput = {
      sourceId: 'item-3',
      summary: 'Inspection',
      description: 'Site visit',
      startIso: '2026-07-01T08:00:00.000Z',
      calendarId: 'primary',
    };
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } },
      { ok: true, status: 201, json: { id: 'x' } },
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });

    await provider.upsertEvent(ACCESS_TOKEN, minimal);

    const body = JSON.parse(
      (fetcher as FetchMock).mock.calls[1][1].body as string,
    );
    expect(body.start.timeZone).toBe('UTC');
    expect(body.end.timeZone).toBe('UTC');
    expect(body.end.dateTime).toBe('2026-07-01T08:30:00.000Z');
  });
});

describe('createMicrosoftCalendarProvider — update (PATCH /me/events/{id})', () => {
  it('PATCHes the resolved id when a stamped event exists; no POST', async () => {
    const existingId = 'AAMkAGI-existing-id';
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [{ id: existingId }] } }, // list hit
      { ok: true, status: 200, json: { id: existingId } }, // PATCH
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });

    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);

    expect(result).toEqual({
      status: 'updated',
      provider: 'microsoft',
      eventId: existingId,
    });

    const calls = (fetcher as FetchMock).mock.calls;
    expect(calls).toHaveLength(2);

    // PATCH targets /me/events/{id} (NOT the collection) and DROPS the immutable
    // transactionId from the body.
    const [patchUrl, patchInit] = calls[1];
    expect(patchUrl).toBe(
      `${GRAPH_BASE}/me/events/${encodeURIComponent(existingId)}`,
    );
    expect(patchInit.method).toBe('PATCH');
    const body = JSON.parse(patchInit.body as string);
    expect(body).not.toHaveProperty('transactionId');
    expect(body.subject).toBe(baseInput.summary);
    // The extended-property stamp survives the patch.
    expect(body.singleValueExtendedProperties).toEqual([
      { id: EXT_PROP_ID, value: baseInput.sourceId },
    ]);

    // No POST to the collection happened.
    const posted = calls.some(
      (c) => c[0] === `${GRAPH_BASE}/me/events` && c[1].method === 'POST',
    );
    expect(posted).toBe(false);
  });

  it('escapes single quotes in the OData filter literal', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } },
      { ok: true, status: 201, json: { id: 'x' } },
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });

    await provider.upsertEvent(ACCESS_TOKEN, {
      ...baseInput,
      sourceId: "o'brien-1",
    });

    const decoded = decodeURIComponent(
      (fetcher as FetchMock).mock.calls[0][0] as string,
    );
    // The single quote is doubled per OData escaping rules.
    expect(decoded).toContain("ep/value eq 'o''brien-1'");
  });
});

describe('createMicrosoftCalendarProvider — idempotency under retry', () => {
  it('first dispatch creates; retry finds the stamp → PATCH, no 2nd POST', async () => {
    const existingId = 'AAMkAGI-id';

    const fetcher1 = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } },
      { ok: true, status: 201, json: { id: existingId } },
    ]);
    const provider1 = createMicrosoftCalendarProvider({ fetcher: fetcher1 });
    const first = await provider1.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(first.status).toBe('created');

    const fetcher2 = scriptedFetcher([
      { ok: true, status: 200, json: { value: [{ id: existingId }] } },
      { ok: true, status: 200, json: { id: existingId } },
    ]);
    const provider2 = createMicrosoftCalendarProvider({ fetcher: fetcher2 });
    const retry = await provider2.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(retry.status).toBe('updated');

    // The retry made exactly one mutating call and it was a PATCH.
    const mutating = (fetcher2 as FetchMock).mock.calls.filter(
      (c) => c[1].method !== 'GET',
    );
    expect(mutating).toHaveLength(1);
    expect(mutating[0][1].method).toBe('PATCH');
  });
});

describe('createMicrosoftCalendarProvider — failures', () => {
  it('maps a non-404 list failure to a retryable failure', async () => {
    const fetcher = scriptedFetcher([{ ok: false, status: 503, text: 'down' }]);
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('ms_list_503');
      expect(result.retryable).toBe(true);
    }
  });

  it('treats a 404 list as "no event" and proceeds to POST', async () => {
    const fetcher = scriptedFetcher([
      { ok: false, status: 404 },
      { ok: true, status: 201, json: { id: 'created-id' } },
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('created');
  });

  it('maps a 4xx POST to a non-retryable failure', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [] } },
      { ok: false, status: 400, text: 'bad' },
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('ms_post_400');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps a failing PATCH to a failure carrying the status', async () => {
    const fetcher = scriptedFetcher([
      { ok: true, status: 200, json: { value: [{ id: 'e1' }] } },
      { ok: false, status: 429, text: 'slow' },
    ]);
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('ms_patch_429');
      expect(result.retryable).toBe(true);
    }
  });

  it('returns a retryable network error when the fetcher throws', async () => {
    const fetcher: CalendarFetcher = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const provider = createMicrosoftCalendarProvider({ fetcher });
    const result = await provider.upsertEvent(ACCESS_TOKEN, baseInput);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('ms_network_error');
      expect(result.retryable).toBe(true);
    }
  });
});
