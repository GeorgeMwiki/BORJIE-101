/**
 * HubSpot poller — one CRM object type at a time, advancing the
 * `hs_lastmodifieddate` watermark on each pass.
 */

import { searchObjects, type SearchOutcome } from '../client/hubspot-client.js';
import { normaliseHubSpotRow } from './normalizer.js';
import type { SaltedHashRedactor } from '../redact/pii-redactor.js';
import type { FetcherPort, HubSpotObjectPayload, HubSpotObjectType } from '../types.js';

const PROPERTIES_BY_TYPE: Readonly<Record<HubSpotObjectType, ReadonlyArray<string>>> = {
  contacts: ['firstname', 'lastname', 'company', 'email', 'phone', 'mobilephone', 'hs_lastmodifieddate'],
  deals: ['dealname', 'amount', 'dealstage', 'closedate', 'hs_lastmodifieddate'],
  tickets: ['subject', 'content', 'hs_pipeline_stage', 'hs_lastmodifieddate'],
  marketing_emails: ['name', 'subject', 'state', 'hs_lastmodifieddate'],
};

export interface PollParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly objectType: HubSpotObjectType;
  readonly since: string | null;
  readonly limit: number;
  readonly redactor: SaltedHashRedactor;
  readonly fetcher: FetcherPort;
}

export type PollOutcome =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<{
        readonly payload: HubSpotObjectPayload;
        readonly redactionApplied: ReadonlyArray<string>;
        readonly raw: Readonly<Record<string, unknown>>;
      }>;
      readonly nextSince: string;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function pollHubSpot(params: PollParams): Promise<PollOutcome> {
  const outcome: SearchOutcome = await searchObjects({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
    objectType: params.objectType,
    after: undefined,
    modifiedAfter: params.since,
    limit: params.limit,
    properties: PROPERTIES_BY_TYPE[params.objectType],
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
    readonly payload: HubSpotObjectPayload;
    readonly redactionApplied: ReadonlyArray<string>;
    readonly raw: Readonly<Record<string, unknown>>;
  }> = [];
  let highest = params.since ?? '';
  for (const row of outcome.result.results) {
    const { redacted, redactedFields } = await params.redactor.redact(row as unknown as Readonly<Record<string, unknown>>);
    const normalised = normaliseHubSpotRow({
      objectType: params.objectType,
      row: redacted as never,
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
    hasMore: outcome.result.paging?.next?.after !== undefined,
  };
}
