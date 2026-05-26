/**
 * Twilio Calls resource client — list calls.
 *
 * Reference: Twilio, *Call resource* —
 * https://www.twilio.com/docs/voice/api/call-resource
 *
 * Endpoint: GET /2010-04-01/Accounts/{Sid}/Calls.json
 * Filters:  StartTime>=YYYY-MM-DD (ISO date)
 * Pagination: `next_page_uri` (Twilio's classic style — full path).
 */

import type { FetcherPort } from '../types.js';

export interface ListCallsParams {
  readonly authorization: string;
  readonly subAccountSid: string;
  readonly startedAfter: string | null; // YYYY-MM-DD
  readonly pageSize: number;
  readonly nextPageUri: string | null;
  readonly fetcher: FetcherPort;
  readonly baseUrl?: string; // defaults to https://api.twilio.com
}

export interface TwilioCall {
  readonly sid: string;
  readonly account_sid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: string;
  readonly status?: string;
  readonly duration?: string;
  readonly start_time?: string;
  readonly end_time?: string;
}

export type ListCallsOutcome =
  | { readonly kind: 'ok'; readonly calls: ReadonlyArray<TwilioCall>; readonly nextPageUri: string | null }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

const DEFAULT_BASE = 'https://api.twilio.com';

export async function listCalls(params: ListCallsParams): Promise<ListCallsOutcome> {
  const base = params.baseUrl ?? DEFAULT_BASE;
  let url: string;
  if (params.nextPageUri !== null) {
    url = `${base}${params.nextPageUri}`;
  } else {
    const u = new URL(`${base}/2010-04-01/Accounts/${encodeURIComponent(params.subAccountSid)}/Calls.json`);
    u.searchParams.set('PageSize', String(params.pageSize));
    if (params.startedAfter !== null) {
      u.searchParams.set('StartTime>', params.startedAfter);
    }
    url = u.toString();
  }
  const res = await params.fetcher.fetch(url, {
    method: 'GET',
    headers: {
      authorization: params.authorization,
      accept: 'application/json',
    },
  });
  if (res.status === 401) return { kind: 'auth-failed' };
  if (res.status === 429) {
    const retryAfter = Number(res.headers['retry-after'] ?? '1');
    return { kind: 'rate-limited', retryAfterMs: Math.max(retryAfter, 1) * 1000 };
  }
  if (res.status < 200 || res.status >= 300) {
    const message = await res.text().catch(() => '');
    return { kind: 'upstream-error', status: res.status, message };
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'upstream-error', status: res.status, message: 'non-JSON body' };
  }
  if (typeof json !== 'object' || json === null) {
    return { kind: 'upstream-error', status: res.status, message: 'bad shape' };
  }
  const j = json as Record<string, unknown>;
  const calls = Array.isArray(j.calls) ? (j.calls as TwilioCall[]) : [];
  const next = typeof j.next_page_uri === 'string' && j.next_page_uri !== ''
    ? (j.next_page_uri as string)
    : null;
  return { kind: 'ok', calls, nextPageUri: next };
}
