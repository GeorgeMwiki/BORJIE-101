/**
 * TEST FIXTURES — synthetic Gmail + Outlook payloads for offline tests.
 *
 * NOT IMPORTED FROM PRODUCTION PATHS.
 */

import type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
} from '../../types.js';

export const GOOGLE_OAUTH_OK_PAYLOAD = {
  access_token: 'ya29-test-access',
  refresh_token: '1//test-refresh',
  expires_in: 3600,
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  token_type: 'Bearer',
};

export const MICROSOFT_OAUTH_OK_PAYLOAD = {
  access_token: 'ms-test-access',
  refresh_token: 'ms-test-refresh',
  expires_in: 3600,
  scope: 'Mail.Read offline_access',
  token_type: 'Bearer',
};

export const GMAIL_LIST_OK_PAYLOAD = {
  messages: [{ id: '18a1', threadId: 't-1' }, { id: '18a2', threadId: 't-1' }],
  resultSizeEstimate: 2,
};

export const GMAIL_GET_OK_PAYLOAD = {
  id: '18a1',
  threadId: 't-1',
  labelIds: ['Label_Borjie', 'INBOX'],
  snippet: 'Permit renewal request received.',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Subject', value: 'Permit renewal — site SX-12' },
      { name: 'From', value: 'Permits Office <permits@tumemadini.go.tz>' },
      { name: 'To', value: 'Mr. Mwikila <mwikila@example.com>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        filename: '',
        body: {
          // base64url("Hello Mwikila — please confirm by emailing perm@example.com")
          data: 'SGVsbG8gTXdpa2lsYSDigJQgcGxlYXNlIGNvbmZpcm0gYnkgZW1haWxpbmcgcGVybUBleGFtcGxlLmNvbQ==',
        },
      },
    ],
  },
};

export const OUTLOOK_LIST_OK_PAYLOAD = {
  value: [
    {
      id: 'AAMkAGI=',
      conversationId: 'conv-1',
      subject: 'Quarterly safety briefing',
      bodyPreview: 'Reminder — safety briefing on Friday.',
      from: {
        emailAddress: { address: 'safety@tumemadini.go.tz', name: 'Safety Officer' },
      },
      toRecipients: [
        {
          emailAddress: { address: 'mwikila@example.com', name: 'Mr. Mwikila' },
        },
      ],
      body: {
        contentType: 'text',
        content: 'Reminder — safety briefing on Friday. Call +255 754 999 888 to confirm.',
      },
      hasAttachments: false,
      receivedDateTime: '2026-05-26T08:00:00Z',
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
    statusText: status === 200 ? 'OK' : status === 429 ? 'Too Many Requests' : 'Error',
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
