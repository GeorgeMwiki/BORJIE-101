/**
 * GitHub REST client — `/repos/{owner}/{repo}/issues?since=…`.
 *
 * Reference: GitHub, *REST API Issues* —
 * https://docs.github.com/en/rest/issues/issues
 */

import type { FetcherPort } from '../types.js';

export interface ListIssuesParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly owner: string;
  readonly repo: string;
  readonly since: string | null; // ISO
  readonly perPage: number;
  readonly fetcher: FetcherPort;
}

export interface GitHubIssue {
  readonly id: number;
  readonly node_id: string;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly updated_at: string;
  readonly pull_request?: Readonly<Record<string, unknown>>;
  readonly user?: { readonly login?: string; readonly email?: string };
}

export type ListIssuesOutcome =
  | { readonly kind: 'ok'; readonly issues: ReadonlyArray<GitHubIssue>; readonly rateLimitRemaining: number }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function listIssues(params: ListIssuesParams): Promise<ListIssuesOutcome> {
  const url = new URL(`${params.baseUrl}/repos/${params.owner}/${params.repo}/issues`);
  url.searchParams.set('state', 'all');
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('direction', 'asc');
  url.searchParams.set('per_page', String(params.perPage));
  if (params.since !== null) url.searchParams.set('since', params.since);
  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (res.status === 401) return { kind: 'auth-failed' };
  if (res.status === 403 || res.status === 429) {
    const remainingHeader = res.headers['x-ratelimit-remaining'];
    const resetHeader = res.headers['x-ratelimit-reset'];
    const remaining = typeof remainingHeader === 'string' ? Number(remainingHeader) : 1;
    if (remaining === 0) {
      const reset = typeof resetHeader === 'string' ? Number(resetHeader) * 1000 : 0;
      const retryAfterMs = reset > 0 ? Math.max(reset - Date.now(), 1000) : 60_000;
      return { kind: 'rate-limited', retryAfterMs };
    }
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
  const issues = Array.isArray(json) ? (json as GitHubIssue[]) : [];
  const remainingHeader = res.headers['x-ratelimit-remaining'];
  const remaining = typeof remainingHeader === 'string' ? Number(remainingHeader) : 5000;
  return { kind: 'ok', issues, rateLimitRemaining: remaining };
}
