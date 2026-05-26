/**
 * Jira poller — runs a JQL search filtered by `updated >= $since`,
 * advances cursor.
 */

import { searchIssues, type SearchOutcome } from '../client/jira-client.js';
import { normaliseJiraIssue } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, JiraEntityKind, JiraEntityPayload } from '../types.js';

export interface PollParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly kind: JiraEntityKind;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: JiraEntityPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollJira(params: PollParams): Promise<PollOutcome> {
  const jql =
    params.since !== null
      ? `updated >= "${jqlDate(params.since)}" ORDER BY updated ASC`
      : 'ORDER BY updated ASC';
  const outcome: SearchOutcome = await searchIssues({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
    jql,
    fields: ['summary', 'status', 'assignee', 'reporter', 'updated'],
    startAt: 0,
    maxResults: params.limit,
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
    readonly payload: JiraEntityPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const issue of outcome.result.issues) {
    const { redacted, redactedFields } = await params.redactor.redact(
      issue as unknown as Readonly<Record<string, unknown>>,
    );
    const normalised = normaliseJiraIssue({
      kind: params.kind,
      issue: redacted as Readonly<Record<string, unknown>>,
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
    hasMore: outcome.result.startAt + outcome.result.issues.length < outcome.result.total,
  };
}

function jqlDate(iso: string): string {
  // JQL date format: "yyyy-MM-dd HH:mm" — drop seconds and TZ markers.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}
