/**
 * Jira REST client — `/rest/api/3/search` with JQL.
 *
 * Reference: Atlassian, *Jira REST API v3 — Search* —
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
 */

import type { FetcherPort } from '../types.js';

export interface SearchParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly jql: string;
  readonly fields: ReadonlyArray<string>;
  readonly startAt: number;
  readonly maxResults: number;
  readonly fetcher: FetcherPort;
}

export interface SearchIssue {
  readonly id: string;
  readonly key: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface SearchResult {
  readonly issues: ReadonlyArray<SearchIssue>;
  readonly total: number;
  readonly startAt: number;
  readonly maxResults: number;
}

export type SearchOutcome =
  | { readonly kind: 'ok'; readonly result: SearchResult }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function searchIssues(params: SearchParams): Promise<SearchOutcome> {
  const url = `${params.baseUrl}/rest/api/3/search`;
  const body = {
    jql: params.jql,
    fields: params.fields,
    startAt: params.startAt,
    maxResults: params.maxResults,
  };
  const res = await params.fetcher.fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
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
  const issues = Array.isArray(j.issues) ? (j.issues as SearchIssue[]) : [];
  return {
    kind: 'ok',
    result: {
      issues,
      total: typeof j.total === 'number' ? j.total : issues.length,
      startAt: typeof j.startAt === 'number' ? j.startAt : params.startAt,
      maxResults: typeof j.maxResults === 'number' ? j.maxResults : params.maxResults,
    },
  };
}
