/**
 * Zoom poller — lists past meetings since the cursor, normalises,
 * advances cursor on `start_time`.
 *
 * Zoom's "past meetings" list endpoint takes `from`/`to` YYYY-MM-DD
 * dates. The poller derives those from the in-memory ISO cursor.
 */

import { listPastMeetings, type ListMeetingsOutcome } from '../client/zoom-client.js';
import { normaliseZoomMeeting } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, ZoomMeetingPayload } from '../types.js';

export interface PollParams {
  readonly accessToken: string;
  readonly userId: string;
  readonly since: string | null;
  readonly until: string | null;
  readonly pageSize: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: ZoomMeetingPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

function toYmd(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function pollZoom(params: PollParams): Promise<PollOutcome> {
  const outcome: ListMeetingsOutcome = await listPastMeetings({
    accessToken: params.accessToken,
    userId: params.userId,
    from: toYmd(params.since),
    to: toYmd(params.until),
    pageSize: params.pageSize,
    nextPageToken: null,
    fetcher: params.fetcher,
  });
  if (outcome.kind === 'auth-failed') return { kind: 'auth-failed' };
  if (outcome.kind === 'rate-limited') {
    return { kind: 'rate-limited', retryAfterMs: outcome.retryAfterMs };
  }
  if (outcome.kind === 'upstream-error') {
    return { kind: 'upstream-error', status: outcome.status, message: outcome.message };
  }
  const items: Array<{
    readonly payload: ZoomMeetingPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const meeting of outcome.meetings) {
    const meetingRec = meeting as unknown as Readonly<Record<string, unknown>>;
    const { redacted, redactedFields } = await params.redactor.redact(meetingRec);
    const normalised = normaliseZoomMeeting({
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    if (normalised === null) continue;
    items.push({
      payload: normalised,
      redactionApplied: redactedFields,
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    if (normalised.startAt > highest) highest = normalised.startAt;
  }
  return {
    kind: 'ok',
    items,
    nextSince: highest === '' ? new Date().toISOString() : highest,
    hasMore: outcome.nextPageToken !== null,
  };
}
