/**
 * TEST FIXTURES — synthetic Slack payloads for offline tests.
 *
 * NOT IMPORTED FROM PRODUCTION PATHS. The connector packages
 * never reach into `__tests__/` at runtime — this file lives only
 * to keep the test suite hermetic.
 */

import type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
} from '../../types.js';

export const SLACK_OAUTH_OK_PAYLOAD = {
  ok: true,
  access_token: 'xoxb-test-bot-token',
  token_type: 'Bearer',
  scope: 'channels:history,channels:read,users:read',
  bot_user_id: 'B01TEST',
  team: { id: 'T01TEAM', name: 'Borjie Test Workspace' },
  enterprise: null,
  authed_user: { id: 'U01ADMIN' },
  refresh_token: 'xoxe-1-test-refresh',
  expires_in: 43200,
};

export const SLACK_HISTORY_OK_PAYLOAD = {
  ok: true,
  messages: [
    {
      type: 'message',
      ts: '1700000000.000100',
      user: 'U01ADMIN',
      text: 'Permit renewal due — email mwikila@example.com to confirm.',
    },
    {
      type: 'message',
      ts: '1700000005.000100',
      user: 'U02OPS',
      text: 'Calling Mr. Mwikila on +255 754 123 456 to confirm.',
      thread_ts: '1700000000.000100',
    },
  ],
  has_more: false,
  response_metadata: { next_cursor: '' },
};

export const SLACK_HISTORY_PAGE_TWO_PAYLOAD = {
  ok: true,
  messages: [
    {
      type: 'message',
      ts: '1700000010.000100',
      user: 'U03TECH',
      text: 'Patch deployed.',
    },
  ],
  has_more: false,
  response_metadata: { next_cursor: '' },
};

export function buildFetcherResponse(
  payload: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): FetcherResponse {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 429 ? 'Too Many Requests' : 'Error',
    headers: new Map(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/**
 * Build a fetcher that returns canned responses based on the URL +
 * a request counter. Useful for cursor + retry tests.
 */
export function createCannedFetcher(
  responses: ReadonlyArray<FetcherResponse>,
): { fetcher: Fetcher; calls: FetcherRequest[] } {
  const calls: FetcherRequest[] = [];
  let i = 0;
  const fetcher: Fetcher = async (req) => {
    calls.push(req);
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (res === undefined) throw new Error('canned fetcher out of responses');
    return res;
  };
  return { fetcher, calls };
}
