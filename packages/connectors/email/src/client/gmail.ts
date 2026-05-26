/**
 * Gmail Web API thin client.
 *
 * Per "Gmail API Users.messages: list"
 * (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list, accessed 2026-05-26):
 * we walk `users.messages.list` with a label filter and a `pageToken`
 * cursor, then fetch each message via `users.messages.get`.
 */

import type { Fetcher, GmailApiMessage } from '../types.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

export interface GmailListRequest {
  readonly accessToken: string;
  readonly labels: ReadonlyArray<string>;
  readonly cursor: string | null;
  readonly limit: number;
}

export type GmailListResponse =
  | {
      readonly kind: 'ok';
      readonly messageIds: ReadonlyArray<string>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export type GmailGetResponse =
  | { readonly kind: 'ok'; readonly message: GmailApiMessage }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface GmailClientDeps {
  readonly fetcher: Fetcher;
}

export function createGmailClient(deps: GmailClientDeps) {
  return {
    list: async (req: GmailListRequest): Promise<GmailListResponse> => {
      const params = new URLSearchParams({
        maxResults: String(req.limit),
      });
      for (const label of req.labels) params.append('labelIds', label);
      if (req.cursor !== null && req.cursor !== '') {
        params.set('pageToken', req.cursor);
      }
      const url = `${GMAIL_API_BASE}/users/me/messages?${params.toString()}`;
      try {
        const res = await deps.fetcher({
          url,
          method: 'GET',
          headers: {
            authorization: `Bearer ${req.accessToken}`,
            accept: 'application/json',
          },
        });
        return parseListResponse(res);
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
    get: async (
      req: { accessToken: string; messageId: string },
    ): Promise<GmailGetResponse> => {
      const url = `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(req.messageId)}?format=full`;
      try {
        const res = await deps.fetcher({
          url,
          method: 'GET',
          headers: {
            authorization: `Bearer ${req.accessToken}`,
            accept: 'application/json',
          },
        });
        return parseGetResponse(res);
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
  };
}

async function parseListResponse(
  res: Awaited<ReturnType<Fetcher>>,
): Promise<GmailListResponse> {
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
  const messages = Array.isArray(payload['messages']) ? payload['messages'] : [];
  const ids = messages
    .map((m) => (m as { id?: string }).id)
    .filter((id): id is string => typeof id === 'string');
  const nextPageToken = payload['nextPageToken'];
  const nextCursor =
    typeof nextPageToken === 'string' && nextPageToken !== ''
      ? nextPageToken
      : null;
  return { kind: 'ok', messageIds: ids, nextCursor };
}

async function parseGetResponse(
  res: Awaited<ReturnType<Fetcher>>,
): Promise<GmailGetResponse> {
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
  const payload = (await res.json()) as GmailApiMessage;
  return { kind: 'ok', message: payload };
}

export type GmailClient = ReturnType<typeof createGmailClient>;
