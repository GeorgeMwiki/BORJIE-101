/**
 * Slack Web API thin client.
 *
 * Wraps the cursor-based `conversations.history` endpoint
 * (https://api.slack.com/methods/conversations.history, accessed
 * 2026-05-26). The connector ingests messages by walking the
 * cursor; nothing here writes to Slack.
 *
 * Rate-limit handling: Slack returns `429` with `Retry-After`. The
 * client surfaces the header verbatim; the poller decides whether
 * to honour or yield to the scheduler.
 */

import type { Fetcher, SlackApiMessage } from '../types.js';

const SLACK_API_BASE = 'https://slack.com/api';

export interface SlackHistoryRequest {
  readonly accessToken: string;
  readonly channelId: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export type SlackHistoryResponse =
  | {
      readonly kind: 'ok';
      readonly messages: ReadonlyArray<SlackApiMessage>;
      readonly nextCursor: string | null;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface SlackWebClientDeps {
  readonly fetcher: Fetcher;
}

export function createSlackWebClient(deps: SlackWebClientDeps) {
  return {
    history: async (req: SlackHistoryRequest): Promise<SlackHistoryResponse> => {
      const params = new URLSearchParams({
        channel: req.channelId,
        limit: String(req.limit),
      });
      if (req.cursor !== null && req.cursor !== '') {
        params.set('cursor', req.cursor);
      }
      const url = `${SLACK_API_BASE}/conversations.history?${params.toString()}`;
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
          const retryAfterHeader = res.headers.get('retry-after') ?? '1';
          const retryAfterSec = Number.parseInt(retryAfterHeader, 10);
          return {
            kind: 'rate-limited',
            retryAfterMs: Number.isNaN(retryAfterSec)
              ? 1000
              : retryAfterSec * 1000,
          };
        }
        if (!res.ok) {
          return { kind: 'upstream-error', status: res.status, message: res.statusText };
        }
        const payload = (await res.json()) as Record<string, unknown>;
        if (payload['ok'] !== true) {
          const error =
            typeof payload['error'] === 'string'
              ? payload['error']
              : 'unknown';
          if (
            error === 'invalid_auth' ||
            error === 'token_revoked' ||
            error === 'not_authed'
          ) {
            return { kind: 'auth-failed', message: error };
          }
          return { kind: 'upstream-error', status: res.status, message: error };
        }
        const rawMessages = Array.isArray(payload['messages'])
          ? (payload['messages'] as ReadonlyArray<SlackApiMessage>)
          : [];
        const metadata = payload['response_metadata'] as
          | { next_cursor?: string }
          | undefined;
        const nextCursor =
          metadata && typeof metadata.next_cursor === 'string' && metadata.next_cursor !== ''
            ? metadata.next_cursor
            : null;
        const hasMore = payload['has_more'] === true && nextCursor !== null;
        return { kind: 'ok', messages: rawMessages, nextCursor, hasMore };
      } catch (error) {
        return {
          kind: 'transport-error',
          message: error instanceof Error ? error.message : 'unknown transport error',
        };
      }
    },
  };
}

export type SlackWebClient = ReturnType<typeof createSlackWebClient>;
