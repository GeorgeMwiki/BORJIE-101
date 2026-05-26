/**
 * Teams poller — lists channel messages since the cursor, normalises,
 * advances cursor on `lastModifiedDateTime`.
 */

import { listChannelMessages, type ListMessagesOutcome } from '../client/teams-client.js';
import { normaliseTeamsMessage } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, TeamsMessagePayload } from '../types.js';

export interface PollParams {
  readonly accessToken: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: TeamsMessagePayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollTeams(params: PollParams): Promise<PollOutcome> {
  const outcome: ListMessagesOutcome = await listChannelMessages({
    accessToken: params.accessToken,
    teamId: params.teamId,
    channelId: params.channelId,
    modifiedAfter: params.since,
    limit: params.limit,
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
    readonly payload: TeamsMessagePayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const msg of outcome.messages) {
    const { redacted, redactedFields } = await params.redactor.redact(
      msg as unknown as Readonly<Record<string, unknown>>,
    );
    const normalised = normaliseTeamsMessage({
      teamId: params.teamId,
      channelId: params.channelId,
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    if (normalised === null) continue;
    items.push({
      payload: normalised,
      redactionApplied: redactedFields,
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    const msgRec = msg as unknown as Record<string, unknown>;
    const lmd =
      typeof msgRec.lastModifiedDateTime === 'string'
        ? (msgRec.lastModifiedDateTime as string)
        : normalised.sentAt;
    if (lmd > highest) highest = lmd;
  }
  return {
    kind: 'ok',
    items,
    nextSince: highest === '' ? new Date().toISOString() : highest,
    hasMore: outcome.nextLink !== null,
  };
}
