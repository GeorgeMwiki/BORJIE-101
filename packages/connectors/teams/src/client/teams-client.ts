/**
 * Microsoft Graph client — listChannelMessages.
 *
 * Reference: Microsoft, *channel: list messages* —
 * https://learn.microsoft.com/en-us/graph/api/channel-list-messages
 */

import type { FetcherPort } from '../types.js';

export interface ListMessagesParams {
  readonly accessToken: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly modifiedAfter: string | null;
  readonly limit: number;
  readonly fetcher: FetcherPort;
}

export interface GraphMessage {
  readonly id: string;
  readonly createdDateTime: string;
  readonly lastModifiedDateTime?: string;
  readonly from?: { readonly user?: { readonly displayName?: string; readonly userIdentityType?: string } };
  readonly body?: { readonly contentType?: string; readonly content?: string };
  readonly attachments?: ReadonlyArray<{
    readonly id: string;
    readonly contentType: string;
    readonly name?: string;
    readonly contentUrl?: string;
  }>;
}

export type ListMessagesOutcome =
  | { readonly kind: 'ok'; readonly messages: ReadonlyArray<GraphMessage>; readonly nextLink: string | null }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function listChannelMessages(
  params: ListMessagesParams,
): Promise<ListMessagesOutcome> {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(params.teamId)}/channels/${encodeURIComponent(params.channelId)}/messages`,
  );
  url.searchParams.set('$top', String(params.limit));
  if (params.modifiedAfter !== null) {
    url.searchParams.set('$filter', `lastModifiedDateTime gt ${params.modifiedAfter}`);
  }
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
  const messages = Array.isArray(j.value) ? (j.value as GraphMessage[]) : [];
  const nextLink = typeof j['@odata.nextLink'] === 'string' ? (j['@odata.nextLink'] as string) : null;
  return { kind: 'ok', messages, nextLink };
}
