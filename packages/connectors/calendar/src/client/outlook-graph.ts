/**
 * Microsoft Graph calendar client.
 *
 * Per "Microsoft Graph calendar overview"
 * (https://learn.microsoft.com/en-us/graph/api/resources/calendar, accessed 2026-05-26):
 * we use the `calendarView` endpoint with a `$skiptoken` cursor for
 * incremental ingest.
 */

import type { Fetcher, OutlookApiEvent } from '../types.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export interface OutlookEventsRequest {
  readonly accessToken: string;
  readonly calendarId: string;
  readonly cursor: string | null;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
  readonly limit: number;
}

export type OutlookEventsResponse =
  | {
      readonly kind: 'ok';
      readonly events: ReadonlyArray<OutlookApiEvent>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface OutlookCalClientDeps {
  readonly fetcher: Fetcher;
}

export function createOutlookCalendarClient(deps: OutlookCalClientDeps) {
  return {
    events: async (req: OutlookEventsRequest): Promise<OutlookEventsResponse> => {
      const params = new URLSearchParams({
        startDateTime: req.windowStartIso,
        endDateTime: req.windowEndIso,
        $top: String(req.limit),
      });
      const url =
        req.cursor !== null && req.cursor !== ''
          ? `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(req.calendarId)}/calendarView?${params.toString()}&$skiptoken=${encodeURIComponent(req.cursor)}`
          : `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(req.calendarId)}/calendarView?${params.toString()}`;
      try {
        const res = await deps.fetcher({
          url,
          method: 'GET',
          headers: {
            authorization: `Bearer ${req.accessToken}`,
            accept: 'application/json',
          },
        });
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
        const value = Array.isArray(payload['value']) ? payload['value'] : [];
        const events = value as ReadonlyArray<OutlookApiEvent>;
        const nextLink = payload['@odata.nextLink'];
        const nextCursor =
          typeof nextLink === 'string' && nextLink !== ''
            ? extractSkipToken(nextLink)
            : null;
        return { kind: 'ok', events, nextCursor };
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
  };
}

function extractSkipToken(link: string): string | null {
  const match = link.match(/\$skiptoken=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export type OutlookCalendarClient = ReturnType<typeof createOutlookCalendarClient>;
