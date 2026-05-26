/**
 * Zoom Meetings REST client — list past meetings for a user.
 *
 * Reference: Zoom, *List meetings* —
 * https://developers.zoom.us/docs/api/meetings/methods/#tag/meetings
 */

import type { FetcherPort } from '../types.js';

export interface ListMeetingsParams {
  readonly accessToken: string;
  readonly userId: string;
  readonly from: string | null; // ISO date YYYY-MM-DD
  readonly to: string | null;
  readonly pageSize: number;
  readonly nextPageToken: string | null;
  readonly fetcher: FetcherPort;
}

export interface ZoomMeeting {
  readonly id: number | string;
  readonly uuid?: string;
  readonly topic?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration?: number;
  readonly host_email?: string;
  readonly participants?: ReadonlyArray<{
    readonly user_id?: string;
    readonly name?: string;
    readonly user_email?: string;
    readonly join_time?: string;
    readonly leave_time?: string;
  }>;
}

export type ListMeetingsOutcome =
  | {
      readonly kind: 'ok';
      readonly meetings: ReadonlyArray<ZoomMeeting>;
      readonly nextPageToken: string | null;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function listPastMeetings(
  params: ListMeetingsParams,
): Promise<ListMeetingsOutcome> {
  const url = new URL(`https://api.zoom.us/v2/users/${encodeURIComponent(params.userId)}/meetings`);
  url.searchParams.set('type', 'past');
  url.searchParams.set('page_size', String(params.pageSize));
  if (params.from !== null) url.searchParams.set('from', params.from);
  if (params.to !== null) url.searchParams.set('to', params.to);
  if (params.nextPageToken !== null) url.searchParams.set('next_page_token', params.nextPageToken);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status === 401) return { kind: 'auth-failed' };
  if (res.status === 429) {
    const retryAfter = Number(res.headers['retry-after'] ?? '5');
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
  const meetings = Array.isArray(j.meetings) ? (j.meetings as ZoomMeeting[]) : [];
  const next = typeof j.next_page_token === 'string' && j.next_page_token !== ''
    ? (j.next_page_token as string)
    : null;
  return { kind: 'ok', meetings, nextPageToken: next };
}
