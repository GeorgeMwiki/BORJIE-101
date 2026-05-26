/**
 * Instagram Graph API client.
 *
 * Reference: Instagram Graph API,
 * https://developers.facebook.com/docs/instagram-api/reference,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

export interface ListMediaParams {
  readonly accessToken: string;
  readonly account: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly fetcher: FetcherPort;
}

export interface ListMediaResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextCursor: string | null;
}

export async function listMedia(
  params: ListMediaParams,
): Promise<ListMediaResult> {
  const url = new URL(`${GRAPH_BASE}/${params.account}/media`);
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set(
    'fields',
    'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
  );
  url.searchParams.set('limit', String(params.limit ?? 25));
  if (params.cursor) url.searchParams.set('after', params.cursor);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (res.status !== 200) {
    throw new Error(`Instagram /media failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    data?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    paging?: { cursors?: { after?: string } };
  };
  return Object.freeze({
    items: json.data ?? [],
    nextCursor: json.paging?.cursors?.after ?? null,
  });
}
