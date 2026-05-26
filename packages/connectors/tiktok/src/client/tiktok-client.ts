/**
 * TikTok Business API client.
 *
 * Reference: TikTok Business API, *Video List*,
 * https://business-api.tiktok.com/portal/docs?id=1738455508553729,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const BIZ_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export interface ListVideosParams {
  readonly accessToken: string;
  readonly advertiserId: string;
  readonly cursor?: string;
  readonly pageSize?: number;
  readonly fetcher: FetcherPort;
}

export interface ListVideosResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextCursor: string | null;
}

export async function listVideos(
  params: ListVideosParams,
): Promise<ListVideosResult> {
  const url = new URL(`${BIZ_BASE}/video/list/`);
  url.searchParams.set('advertiser_id', params.advertiserId);
  url.searchParams.set('page_size', String(params.pageSize ?? 20));
  if (params.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Access-Token': params.accessToken,
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`TikTok /video/list/ failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    data?: {
      list?: ReadonlyArray<Readonly<Record<string, unknown>>>;
      page_info?: { next_cursor?: string };
    };
  };
  return Object.freeze({
    items: json.data?.list ?? [],
    nextCursor: json.data?.page_info?.next_cursor ?? null,
  });
}
