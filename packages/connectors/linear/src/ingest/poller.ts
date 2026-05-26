/**
 * Linear poller — runs an `issues(filter: {updatedAt: {gt: $since}})`
 * GraphQL query and emits normalised payloads.
 */

import { runGraphQLQuery, type GraphQLOutcome } from '../client/linear-client.js';
import { normaliseLinearNode } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, LinearEntityKind, LinearEntityPayload } from '../types.js';

const ISSUE_QUERY = `
  query Issues($since: DateTime, $first: Int!) {
    issues(filter: { updatedAt: { gt: $since } }, orderBy: updatedAt, first: $first) {
      nodes {
        id
        title
        description
        updatedAt
        state { name }
        assignee { email }
      }
      pageInfo { hasNextPage }
    }
  }
`;

export interface PollParams {
  readonly accessToken: string;
  readonly kind: LinearEntityKind;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: LinearEntityPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollLinear(params: PollParams): Promise<PollOutcome> {
  // v1 ships issues query; other entity kinds reuse the same shape with different roots.
  const outcome: GraphQLOutcome = await runGraphQLQuery({
    accessToken: params.accessToken,
    query: ISSUE_QUERY,
    variables: { since: params.since, first: params.limit },
    fetcher: params.fetcher,
  });
  if (outcome.kind === 'auth-failed') return { kind: 'auth-failed' };
  if (outcome.kind === 'rate-limited') {
    return { kind: 'rate-limited', retryAfterMs: outcome.retryAfterMs };
  }
  if (outcome.kind === 'upstream-error') {
    return { kind: 'upstream-error', status: outcome.status, message: outcome.message };
  }
  const data = outcome.result.data ?? {};
  const issues = (data.issues as Record<string, unknown> | undefined) ?? {};
  const nodes = Array.isArray(issues.nodes) ? (issues.nodes as Array<Readonly<Record<string, unknown>>>) : [];
  const pageInfo = (issues.pageInfo as Record<string, unknown> | undefined) ?? {};
  const items: Array<{
    readonly payload: LinearEntityPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const node of nodes) {
    const { redacted, redactedFields } = await params.redactor.redact(node);
    const normalised = normaliseLinearNode({ kind: params.kind, node: redacted as Readonly<Record<string, unknown>> });
    if (normalised === null) continue;
    items.push({
      payload: normalised,
      redactionApplied: redactedFields,
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    if (normalised.updatedAt > highest) highest = normalised.updatedAt;
  }
  return {
    kind: 'ok',
    items,
    nextSince: highest === '' ? new Date().toISOString() : highest,
    hasMore: pageInfo.hasNextPage === true,
  };
}
