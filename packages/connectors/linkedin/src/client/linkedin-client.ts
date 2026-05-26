/**
 * LinkedIn /rest/posts client (Marketing API).
 *
 * Reference: Microsoft Learn, *Posts API*,
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const REST_BASE = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = '202404';

export interface ListPostsParams {
  readonly accessToken: string;
  readonly authorUrn: string;
  readonly start?: number;
  readonly count?: number;
  readonly fetcher: FetcherPort;
}

export interface ListPostsResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextStart: number | null;
}

export async function listPosts(
  params: ListPostsParams,
): Promise<ListPostsResult> {
  const url = new URL(`${REST_BASE}/posts`);
  url.searchParams.set('q', 'author');
  url.searchParams.set('author', params.authorUrn);
  url.searchParams.set('count', String(params.count ?? 20));
  url.searchParams.set('start', String(params.start ?? 0));

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'linkedin-version': LINKEDIN_VERSION,
      'x-restli-protocol-version': '2.0.0',
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`LinkedIn /rest/posts failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    elements?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    paging?: { count?: number; start?: number; total?: number };
  };
  const items = json.elements ?? [];
  // LinkedIn paging: nextStart = start + count if items returned == count.
  const start = json.paging?.start ?? 0;
  const count = json.paging?.count ?? items.length;
  const nextStart = items.length === count && items.length > 0
    ? start + count
    : null;
  return Object.freeze({
    items,
    nextStart,
  });
}
