/**
 * Salesforce REST client — thin wrapper around `/services/data`.
 *
 * Only the SOQL `query` endpoint is exposed in v1; that covers all
 * four entity kinds (Account / Opportunity / Contact / Case) and the
 * `LastModifiedDate` watermark needed by the poller.
 *
 * Reference: Salesforce, *REST API Developer Guide — Query API* —
 * https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */

import type { FetcherPort } from '../types.js';

export interface SoqlQueryParams {
  readonly instanceUrl: string;
  readonly accessToken: string;
  readonly soql: string;
  readonly apiVersion?: string;
  readonly fetcher: FetcherPort;
}

export interface SoqlQueryResultRecord {
  readonly attributes: { readonly type: string; readonly url: string };
  readonly [field: string]: unknown;
}

export interface SoqlQueryResult {
  readonly done: boolean;
  readonly totalSize: number;
  readonly nextRecordsUrl?: string;
  readonly records: ReadonlyArray<SoqlQueryResultRecord>;
}

const DEFAULT_API_VERSION = 'v60.0';

export type SoqlQueryOutcome =
  | { readonly kind: 'ok'; readonly result: SoqlQueryResult }
  | { readonly kind: 'auth-failed'; readonly status: number }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function runSoqlQuery(
  params: SoqlQueryParams,
): Promise<SoqlQueryOutcome> {
  const version = params.apiVersion ?? DEFAULT_API_VERSION;
  const url = new URL(
    `/services/data/${version}/queryAll/`,
    params.instanceUrl,
  );
  url.searchParams.set('q', params.soql);
  const res = await params.fetcher.fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: 'application/json',
    },
  });
  if (res.status === 401) {
    return { kind: 'auth-failed', status: 401 };
  }
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
    return {
      kind: 'upstream-error',
      status: res.status,
      message: 'response was not JSON',
    };
  }
  if (typeof json !== 'object' || json === null) {
    return {
      kind: 'upstream-error',
      status: res.status,
      message: 'response had wrong shape',
    };
  }
  const j = json as Record<string, unknown>;
  const records = Array.isArray(j.records) ? (j.records as SoqlQueryResultRecord[]) : [];
  const nextUrl = typeof j.nextRecordsUrl === 'string' ? j.nextRecordsUrl : undefined;
  const result: SoqlQueryResult = nextUrl !== undefined
    ? {
        done: j.done === true,
        totalSize: typeof j.totalSize === 'number' ? j.totalSize : records.length,
        nextRecordsUrl: nextUrl,
        records,
      }
    : {
        done: j.done === true,
        totalSize: typeof j.totalSize === 'number' ? j.totalSize : records.length,
        records,
      };
  return { kind: 'ok', result };
}
