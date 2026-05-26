/**
 * X API v2 client — read-only timeline + mentions.
 *
 * Reference: X Developer Platform, *Tweets and User Mentions Lookup*,
 * https://developer.x.com/en/docs/x-api/tweets/timelines/introduction,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const V2_BASE = 'https://api.x.com/2';

export interface ListTweetsParams {
  readonly accessToken: string;
  readonly userId: string;
  readonly cursor?: string;
  readonly maxResults?: number;
  readonly fetcher: FetcherPort;
}

export interface ListTweetsResult {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly nextCursor: string | null;
}

const TWEET_FIELDS = [
  'id',
  'text',
  'created_at',
  'public_metrics',
  'entities',
  'referenced_tweets',
].join(',');

export async function listTweets(
  params: ListTweetsParams,
): Promise<ListTweetsResult> {
  const url = new URL(`${V2_BASE}/users/${params.userId}/tweets`);
  url.searchParams.set('tweet.fields', TWEET_FIELDS);
  url.searchParams.set('max_results', String(params.maxResults ?? 25));
  if (params.cursor) url.searchParams.set('pagination_token', params.cursor);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`X /users/:id/tweets failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    data?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    meta?: { next_token?: string };
  };
  return Object.freeze({
    items: json.data ?? [],
    nextCursor: json.meta?.next_token ?? null,
  });
}

export async function listMentions(
  params: ListTweetsParams,
): Promise<ListTweetsResult> {
  const url = new URL(`${V2_BASE}/users/${params.userId}/mentions`);
  url.searchParams.set('tweet.fields', TWEET_FIELDS);
  url.searchParams.set('max_results', String(params.maxResults ?? 25));
  if (params.cursor) url.searchParams.set('pagination_token', params.cursor);

  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`X /users/:id/mentions failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    data?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    meta?: { next_token?: string };
  };
  return Object.freeze({
    items: json.data ?? [],
    nextCursor: json.meta?.next_token ?? null,
  });
}
