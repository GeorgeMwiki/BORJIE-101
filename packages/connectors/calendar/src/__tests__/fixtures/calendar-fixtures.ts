/**
 * TEST FIXTURES — synthetic calendar payloads for offline tests.
 *
 * NOT IMPORTED FROM PRODUCTION PATHS.
 */

import type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
} from '../../types.js';

export const GOOGLE_OAUTH_OK_PAYLOAD = {
  access_token: 'ya29-test',
  refresh_token: '1//rt-test',
  expires_in: 3600,
  scope: 'https://www.googleapis.com/auth/calendar.readonly',
  token_type: 'Bearer',
};

export const MICROSOFT_OAUTH_OK_PAYLOAD = {
  access_token: 'ms-test',
  refresh_token: 'ms-rt-test',
  expires_in: 3600,
  scope: 'Calendars.Read offline_access',
  token_type: 'Bearer',
};

export const GOOGLE_EVENTS_OK_PAYLOAD = {
  items: [
    {
      id: 'event-001',
      status: 'confirmed',
      summary: 'Permit renewal call',
      description: 'Reminder — confirm with mwikila@example.com about site SX-12.',
      start: { dateTime: '2026-06-01T09:00:00Z' },
      end: { dateTime: '2026-06-01T10:00:00Z' },
      attendees: [
        { email: 'mwikila@example.com', responseStatus: 'accepted' },
        { email: 'safety@tumemadini.go.tz', responseStatus: 'tentative' },
      ],
      location: 'Borjie HQ',
    },
  ],
  nextSyncToken: 'sync-token-XYZ',
};

export const OUTLOOK_EVENTS_OK_PAYLOAD = {
  value: [
    {
      id: 'AAMkAGI=',
      subject: 'Quarterly safety briefing',
      bodyPreview: 'Join here: https://teams.microsoft.com/m/?token=topsecret',
      start: { dateTime: '2026-06-02T13:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-06-02T14:00:00Z', timeZone: 'UTC' },
      attendees: [
        {
          emailAddress: { address: 'mwikila@example.com' },
          status: { response: 'accepted' },
        },
      ],
      location: { displayName: 'Borjie HQ' },
    },
  ],
};

export function buildFetcherResponse(
  payload: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): FetcherResponse {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText:
      status === 200
        ? 'OK'
        : status === 410
          ? 'Gone'
          : status === 429
            ? 'Too Many Requests'
            : 'Error',
    headers: new Map(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

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
