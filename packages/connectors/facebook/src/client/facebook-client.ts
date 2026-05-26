/**
 * Facebook Page Graph API client.
 *
 * Reference:
 * https://developers.facebook.com/docs/graph-api/reference/page/feed,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

export interface ListPostsParams {
  readonly accessToken: string;
  readonly account: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly fetcher: FetcherPort;
}

export interface ListPostsResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextCursor: string | null;
}

export async function listPosts(
  params: ListPostsParams,
): Promise<ListPostsResult> {
  const url = new URL(`${GRAPH_BASE}/${params.account}/posts`);
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set(
    'fields',
    'id,message,created_time,permalink_url,attachments,reactions.summary(total_count),comments.summary(total_count)',
  );
  url.searchParams.set('limit', String(params.limit ?? 25));
  if (params.cursor) url.searchParams.set('after', params.cursor);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (res.status !== 200) {
    throw new Error(`Facebook /posts failed: ${res.status}`);
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
