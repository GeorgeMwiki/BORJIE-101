/**
 * Google Calendar event provider.
 *
 * Idempotent upsert via a CLIENT-SPECIFIED event id. Google lets the caller set
 * the event `id` on `events.insert` as long as it is base32hex
 * (chars `a-v` + `0-9`, length 5–1024). We derive that id deterministically
 * from the source row id (`reminder/item id`), so:
 *
 *   1. GET  /calendars/{cal}/events/{id}
 *        - 200 → PATCH the existing event   → 'updated'
 *        - 404 → INSERT with that id         → 'created'
 *
 * This needs no stored event mapping and never double-creates under retry.
 *
 * API: https://developers.google.com/calendar/api/v3/reference/events
 */

import { createHash } from 'node:crypto';

import type {
  CalendarEventInput,
  CalendarEventProvider,
  CalendarFetcher,
  CalendarProviderDeps,
  CalendarUpsertResult,
} from './types';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

/** base32hex alphabet Google requires for a client-set event id. */
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/**
 * Map an arbitrary source id to a stable, valid Google event id. We SHA-256 the
 * source id and base32hex-encode the digest → 52 chars of `[a-v0-9]`, well
 * inside the 5–1024 bound, collision-safe, and a pure function of the input so
 * every retry targets the same event. Prefixed `borjie` (still in-charset) for
 * provenance.
 */
export function deterministicGoogleEventId(sourceId: string): string {
  const digest = createHash('sha256').update(sourceId, 'utf8').digest();
  let out = '';
  for (const byte of digest) {
    out += BASE32HEX[byte & 0x1f];
  }
  return `borjie${out}`;
}

function endIsoFor(input: CalendarEventInput): string {
  if (input.endIso) return input.endIso;
  const start = Date.parse(input.startIso);
  const end = Number.isFinite(start) ? start + 30 * 60 * 1000 : Date.now();
  return new Date(end).toISOString();
}

function eventBody(input: CalendarEventInput, eventId: string) {
  const timeZone = input.timeZone ?? 'UTC';
  return {
    id: eventId,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startIso, timeZone },
    end: { dateTime: endIsoFor(input), timeZone },
    // Provenance so the owner (and our reconciler) can tell Borjie-managed
    // events apart from manually-created ones.
    extendedProperties: {
      private: { borjieSourceId: input.sourceId, borjieManaged: 'true' },
    },
    source: { title: 'Borjie — Mr. Mwikila', url: 'https://borjie.app' },
  };
}

function defaultFetcher(): CalendarFetcher {
  return fetch as unknown as CalendarFetcher;
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export function createGoogleCalendarProvider(
  deps: CalendarProviderDeps = {},
): CalendarEventProvider {
  const fetcher = deps.fetcher ?? defaultFetcher();

  return {
    provider: 'google',
    async upsertEvent(
      accessToken: string,
      input: CalendarEventInput,
    ): Promise<CalendarUpsertResult> {
      const eventId = deterministicGoogleEventId(input.sourceId);
      const cal = encodeURIComponent(input.calendarId || 'primary');
      const authHeader = { Authorization: `Bearer ${accessToken}` };

      try {
        // 1. Probe for an existing event under our deterministic id.
        const getRes = await fetcher(
          `${GCAL_BASE}/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
          { method: 'GET', headers: authHeader },
        );

        if (getRes.ok) {
          // 2a. Exists → PATCH (id is immutable, so omit it from the body).
          const { id: _omit, ...patchBody } = eventBody(input, eventId);
          const patchRes = await fetcher(
            `${GCAL_BASE}/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
            {
              method: 'PATCH',
              headers: { ...authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify(patchBody),
            },
          );
          if (patchRes.ok) {
            return { status: 'updated', provider: 'google', eventId };
          }
          return {
            status: 'failed',
            provider: 'google',
            errorCode: `google_patch_${patchRes.status}`,
            errorMessage: (await patchRes.text().catch(() => '')).slice(0, 300),
            retryable: retryableStatus(patchRes.status),
          };
        }

        if (getRes.status !== 404) {
          return {
            status: 'failed',
            provider: 'google',
            errorCode: `google_get_${getRes.status}`,
            errorMessage: (await getRes.text().catch(() => '')).slice(0, 300),
            retryable: retryableStatus(getRes.status),
          };
        }

        // 2b. Not found → INSERT with our id.
        const insertRes = await fetcher(
          `${GCAL_BASE}/calendars/${cal}/events`,
          {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(eventBody(input, eventId)),
          },
        );
        if (insertRes.ok) {
          return { status: 'created', provider: 'google', eventId };
        }
        // A 409 here means a concurrent insert already created it — treat as a
        // benign 'updated' so the dispatch still succeeds idempotently.
        if (insertRes.status === 409) {
          return { status: 'updated', provider: 'google', eventId };
        }
        return {
          status: 'failed',
          provider: 'google',
          errorCode: `google_insert_${insertRes.status}`,
          errorMessage: (await insertRes.text().catch(() => '')).slice(0, 300),
          retryable: retryableStatus(insertRes.status),
        };
      } catch (err) {
        return {
          status: 'failed',
          provider: 'google',
          errorCode: 'google_network_error',
          errorMessage: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
      }
    },
  };
}
