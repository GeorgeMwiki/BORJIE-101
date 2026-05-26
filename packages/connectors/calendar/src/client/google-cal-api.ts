/**
 * Google Calendar API thin client.
 *
 * Per "Google Calendar API: events.list"
 * (https://developers.google.com/calendar/api/v3/reference/events/list, accessed 2026-05-26)
 * and "Google Calendar API: sync tokens"
 * (https://developers.google.com/calendar/api/guides/sync, accessed 2026-05-26):
 * we use `syncToken` for incremental ingest and treat HTTP 410
 * (sync token expired) as a sync-token-reset signal.
 */

import type { Fetcher, GoogleApiEvent } from '../types.js';

const GOOGLE_CAL_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleEventsRequest {
  readonly accessToken: string;
  readonly calendarId: string;
  readonly syncToken: string | null;
  readonly limit: number;
}

export type GoogleEventsResponse =
  | {
      readonly kind: 'ok';
      readonly events: ReadonlyArray<GoogleApiEvent>;
      readonly nextSyncToken: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'sync-token-reset' }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface GoogleCalClientDeps {
  readonly fetcher: Fetcher;
}

export function createGoogleCalendarClient(deps: GoogleCalClientDeps) {
  return {
    events: async (req: GoogleEventsRequest): Promise<GoogleEventsResponse> => {
      const params = new URLSearchParams({
        maxResults: String(req.limit),
        singleEvents: 'true',
      });
      if (req.syncToken !== null && req.syncToken !== '') {
        params.set('syncToken', req.syncToken);
      }
      const url = `${GOOGLE_CAL_API_BASE}/calendars/${encodeURIComponent(req.calendarId)}/events?${params.toString()}`;
      try {
        const res = await deps.fetcher({
          url,
          method: 'GET',
          headers: {
            authorization: `Bearer ${req.accessToken}`,
            accept: 'application/json',
          },
        });
        if (res.status === 410) {
          return { kind: 'sync-token-reset' };
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after') ?? '1';
          const retryAfterSec = Number.parseInt(retryAfter, 10);
          return {
            kind: 'rate-limited',
            retryAfterMs: Number.isNaN(retryAfterSec) ? 1000 : retryAfterSec * 1000,
          };
        }
        if (res.status === 401 || res.status === 403) {
          return { kind: 'auth-failed', message: res.statusText };
        }
        if (!res.ok) {
          return { kind: 'upstream-error', status: res.status, message: res.statusText };
        }
        const payload = (await res.json()) as Record<string, unknown>;
        const items = Array.isArray(payload['items']) ? payload['items'] : [];
        const events = items as ReadonlyArray<GoogleApiEvent>;
        const nextSyncToken =
          typeof payload['nextSyncToken'] === 'string'
            ? (payload['nextSyncToken'] as string)
            : null;
        return { kind: 'ok', events, nextSyncToken };
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
  };
}

export type GoogleCalendarClient = ReturnType<typeof createGoogleCalendarClient>;
