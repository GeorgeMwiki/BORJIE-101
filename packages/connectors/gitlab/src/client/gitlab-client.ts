/**
 * GitLab REST client — `/api/v4/projects/:id/issues?updated_after=…`.
 *
 * Reference: GitLab, *Issues API* —
 * https://docs.gitlab.com/ee/api/issues.html
 */

import type { FetcherPort } from '../types.js';

export interface ListIssuesParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly projectId: string | number;
  readonly updatedAfter: string | null;
  readonly perPage: number;
  readonly fetcher: FetcherPort;
}

export interface GitLabIssue {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly state: string;
  readonly updated_at: string;
  readonly author?: { readonly username?: string; readonly email?: string };
}

export type ListIssuesOutcome =
  | { readonly kind: 'ok'; readonly issues: ReadonlyArray<GitLabIssue> }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function listIssues(params: ListIssuesParams): Promise<ListIssuesOutcome> {
  const url = new URL(
    `${params.baseUrl}/api/v4/projects/${encodeURIComponent(String(params.projectId))}/issues`,
  );
  url.searchParams.set('order_by', 'updated_at');
  url.searchParams.set('sort', 'asc');
  url.searchParams.set('per_page', String(params.perPage));
  if (params.updatedAfter !== null) url.searchParams.set('updated_after', params.updatedAfter);
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
  const issues = Array.isArray(json) ? (json as GitLabIssue[]) : [];
  return { kind: 'ok', issues };
}
