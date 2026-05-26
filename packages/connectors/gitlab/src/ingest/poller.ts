/**
 * GitLab poller — `/api/v4/projects/{id}/issues?updated_after=…`.
 */

import { listIssues, type ListIssuesOutcome } from '../client/gitlab-client.js';
import { normaliseGitLabIssue } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, GitLabEntityPayload } from '../types.js';

export interface PollParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly projectId: string | number;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: GitLabEntityPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollGitLab(params: PollParams): Promise<PollOutcome> {
  const outcome: ListIssuesOutcome = await listIssues({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
    projectId: params.projectId,
    updatedAfter: params.since,
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
    readonly payload: GitLabEntityPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const issue of outcome.issues) {
    const { redacted, redactedFields } = await params.redactor.redact(
      issue as unknown as Readonly<Record<string, unknown>>,
    );
    const normalised = normaliseGitLabIssue({
      kind: 'issue',
      raw: redacted as Readonly<Record<string, unknown>>,
    });
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
  };
}
