/**
 * Microsoft Graph mail client.
 *
 * Per "Microsoft Graph mail overview"
 * (https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview, accessed 2026-05-26):
 * we walk `/me/messages` with `$filter=categories/any(c:c eq 'X')`
 * and the `$skiptoken` cursor. Throttling docs at
 * https://learn.microsoft.com/en-us/graph/throttling (accessed 2026-05-26).
 */

import type { Fetcher, OutlookApiMessage } from '../types.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export interface OutlookListRequest {
  readonly accessToken: string;
  readonly categories: ReadonlyArray<string>;
  readonly cursor: string | null;
  readonly limit: number;
}

export type OutlookListResponse =
  | {
      readonly kind: 'ok';
      readonly messages: ReadonlyArray<OutlookApiMessage>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface OutlookGraphClientDeps {
  readonly fetcher: Fetcher;
}

export function createOutlookGraphClient(deps: OutlookGraphClientDeps) {
  return {
    list: async (req: OutlookListRequest): Promise<OutlookListResponse> => {
      const params = new URLSearchParams({
        $top: String(req.limit),
      });
      if (req.categories.length > 0) {
        const filter = req.categories
          .map((c) => `categories/any(c:c eq '${escapeSingleQuote(c)}')`)
          .join(' or ');
        params.set('$filter', filter);
      }
      const url =
        req.cursor !== null && req.cursor !== ''
          ? `${GRAPH_API_BASE}/me/messages?${params.toString()}&$skiptoken=${encodeURIComponent(req.cursor)}`
          : `${GRAPH_API_BASE}/me/messages?${params.toString()}`;
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
        const messages = value as ReadonlyArray<OutlookApiMessage>;
        const nextLink = payload['@odata.nextLink'];
        const nextCursor =
          typeof nextLink === 'string' && nextLink !== ''
            ? extractSkipToken(nextLink)
            : null;
        return { kind: 'ok', messages, nextCursor };
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
  };
}

function escapeSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

function extractSkipToken(link: string): string | null {
  const match = link.match(/\$skiptoken=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export type OutlookGraphClient = ReturnType<typeof createOutlookGraphClient>;
