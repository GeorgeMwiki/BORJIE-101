/**
 * Linear GraphQL client — thin wrapper that posts an `IssuesQuery`
 * with `filter.updatedAt.gt` and a sort order to drive the cursor.
 *
 * Reference: Linear, *GraphQL API* —
 * https://developers.linear.app/docs/graphql/overview
 */

import type { FetcherPort } from '../types.js';

export interface GraphQLQueryParams {
  readonly accessToken: string;
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly fetcher: FetcherPort;
}

export interface GraphQLQueryResult {
  readonly data: Readonly<Record<string, unknown>> | null;
  readonly errors?: ReadonlyArray<{ readonly message: string; readonly extensions?: { readonly code?: string } }>;
}

export type GraphQLOutcome =
  | { readonly kind: 'ok'; readonly result: GraphQLQueryResult }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function runGraphQLQuery(
  params: GraphQLQueryParams,
): Promise<GraphQLOutcome> {
  const res = await params.fetcher.fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      authorization: params.accessToken,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query: params.query, variables: params.variables }),
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
  const errors = Array.isArray(j.errors) ? (j.errors as GraphQLQueryResult['errors']) : undefined;
  // RATELIMITED via GraphQL `extensions.code`.
  if (errors && errors.some((e) => e.extensions?.code === 'RATELIMITED')) {
    return { kind: 'rate-limited', retryAfterMs: 60_000 };
  }
  const data = (j.data as Record<string, unknown>) ?? null;
  return {
    kind: 'ok',
    result: errors !== undefined ? { data, errors } : { data },
  };
}
