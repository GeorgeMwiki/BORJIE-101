/**
 * Salesforce poller — runs one SOQL invocation per `(account,
 * sobject_type)` pair, advances the cursor, and emits normalised
 * `SalesforceSObjectPayload` items.
 *
 * Cursor is `LastModifiedDate` ISO timestamp. Re-ingest is idempotent
 * on the (tenant_id, account, sobject_type, sobject_id) tuple.
 */

import { runSoqlQuery, type SoqlQueryOutcome } from '../client/salesforce-client.js';
import { normaliseSalesforceRecord } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, SalesforceSObjectPayload, SalesforceSObjectType } from '../types.js';

export interface PollParams {
  readonly install: { readonly instanceUrl: string };
  readonly accessToken: string;
  readonly sobjectType: SalesforceSObjectType;
  /** ISO datetime; `null` ⇒ first run (no `WHERE` clause). */
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: SalesforceSObjectPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

const FIELDS_BY_TYPE: Readonly<Record<SalesforceSObjectType, ReadonlyArray<string>>> = {
  Account: ['Id', 'Name', 'Phone', 'Description', 'LastModifiedDate'],
  Opportunity: ['Id', 'Name', 'StageName', 'Amount', 'CloseDate', 'LastModifiedDate'],
  Contact: ['Id', 'Name', 'Email', 'Phone', 'MobilePhone', 'LastModifiedDate'],
  Case: ['Id', 'Subject', 'Status', 'Description', 'LastModifiedDate'],
};

export async function pollSalesforce(params: PollParams): Promise<PollOutcome> {
  const fields = FIELDS_BY_TYPE[params.sobjectType];
  const whereClause =
    params.since !== null
      ? ` WHERE LastModifiedDate > ${params.since}`
      : '';
  const soql = `SELECT ${fields.join(', ')} FROM ${params.sobjectType}${whereClause} ORDER BY LastModifiedDate ASC LIMIT ${params.limit}`;
  const outcome: SoqlQueryOutcome = await runSoqlQuery({
    instanceUrl: params.install.instanceUrl,
    accessToken: params.accessToken,
    soql,
    fetcher: params.fetcher,
  });
  if (outcome.kind === 'auth-failed') return { kind: 'auth-failed' };
  if (outcome.kind === 'rate-limited') {
    return { kind: 'rate-limited', retryAfterMs: outcome.retryAfterMs };
  }
  if (outcome.kind === 'upstream-error') {
    return {
      kind: 'upstream-error',
      status: outcome.status,
      message: outcome.message,
    };
  }
  const items: Array<{
    readonly payload: SalesforceSObjectPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highestLmd = params.since ?? '';
  for (const record of outcome.result.records) {
    const { redacted, redactedFields } = await params.redactor.redact(record as Readonly<Record<string, unknown>>);
    const normalized = normaliseSalesforceRecord({ record: redacted as never });
    if (normalized === null) continue;
    items.push({
      payload: normalized,
      redactionApplied: redactedFields,
      raw: redacted as Readonly<Record<string, unknown>>,
    });
    if (normalized.lastModifiedDate > highestLmd) {
      highestLmd = normalized.lastModifiedDate;
    }
  }
  return {
    kind: 'ok',
    items,
    nextSince: highestLmd === '' ? new Date().toISOString() : highestLmd,
    hasMore: outcome.result.done === false,
  };
}
