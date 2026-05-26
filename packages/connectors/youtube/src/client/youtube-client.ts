/**
 * YouTube Data API v3 client.
 *
 * Reference: Google Developers, *Search.list + Videos.list*,
 * https://developers.google.com/youtube/v3/docs/search/list and
 * https://developers.google.com/youtube/v3/docs/videos/list,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const V3_BASE = 'https://www.googleapis.com/youtube/v3';

export interface ListChannelVideosParams {
  readonly accessToken: string;
  readonly channelId: string;
  readonly pageToken?: string;
  readonly maxResults?: number;
  readonly fetcher: FetcherPort;
}

export interface ListChannelVideosResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextPageToken: string | null;
}

/**
 * Wave 1: `search.list?channelId=…` lists video IDs; wave 2 hits
 * `videos.list?id=…` to refresh statistics. P2 ships the search step;
 * stats refresh comes from the poller chaining `videosList`.
 */
export async function searchChannelVideos(
  params: ListChannelVideosParams,
): Promise<ListChannelVideosResult> {
  const url = new URL(`${V3_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('channelId', params.channelId);
  url.searchParams.set('order', 'date');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(params.maxResults ?? 25));
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`YouTube search.list failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    items?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    nextPageToken?: string;
  };
  return Object.freeze({
    items: json.items ?? [],
    nextPageToken: json.nextPageToken ?? null,
  });
}

export interface VideosListParams {
  readonly accessToken: string;
  readonly videoIds: ReadonlyArray<string>;
  readonly fetcher: FetcherPort;
}

export interface VideosListResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export async function videosList(
  params: VideosListParams,
): Promise<VideosListResult> {
  const url = new URL(`${V3_BASE}/videos`);
  url.searchParams.set('part', 'snippet,statistics,contentDetails');
  url.searchParams.set('id', params.videoIds.join(','));

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`YouTube videos.list failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    items?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  };
  return Object.freeze({
    items: json.items ?? [],
  });
}
