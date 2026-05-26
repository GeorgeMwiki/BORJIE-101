/**
 * GitHub poller — lists repo issues+PRs since the cursor, normalises,
 * advances cursor.
 */

import { listIssues, type ListIssuesOutcome } from '../client/github-client.js';
import { normaliseGitHubIssue } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, GitHubEntityPayload } from '../types.js';

export interface PollParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly owner: string;
  readonly repo: string;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: GitHubEntityPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
      readonly rateLimitRemaining: number;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollGitHub(params: PollParams): Promise<PollOutcome> {
  const outcome: ListIssuesOutcome = await listIssues({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
    owner: params.owner,
    repo: params.repo,
    since: params.since,
    perPage: params.limit,
    fetcher: params.fetcher,
  });
  if (outcome.kind === 'auth-failed') return { kind: 'auth-failed' };
  if (outcome.kind === 'rate-limited') {
    return { kind: 'rate-limited', retryAfterMs: outcome.retryAfterMs };
  }
  if (outcome.kind === 'upstream-error') {
    return { kind: 'upstream-error', status: outcome.status, message: outcome.message };
  }
  const items: Array<{
    readonly payload: GitHubEntityPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const issue of outcome.issues) {
    const { redacted, redactedFields } = await params.redactor.redact(
      issue as unknown as Readonly<Record<string, unknown>>,
    );
    const normalised = normaliseGitHubIssue({ raw: redacted as Readonly<Record<string, unknown>> });
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
    hasMore: outcome.issues.length >= params.limit,
    rateLimitRemaining: outcome.rateLimitRemaining,
  };
}
