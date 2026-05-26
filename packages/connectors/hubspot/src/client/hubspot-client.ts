/**
 * HubSpot REST client — thin wrapper around `/crm/v3/objects/{type}/search`.
 *
 * Reference: HubSpot, *CRM Object Search* —
 * https://developers.hubspot.com/docs/api/crm/search
 */

import type { FetcherPort, HubSpotObjectType } from '../types.js';

export interface SearchParams {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly objectType: HubSpotObjectType;
  readonly after: string | undefined; // paging cursor
  readonly modifiedAfter: string | null; // ISO; null => first run
  readonly limit: number;
  readonly properties: ReadonlyArray<string>;
  readonly fetcher: FetcherPort;
}

export interface SearchResultRow {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly updatedAt?: string;
}

export interface SearchResult {
  readonly results: ReadonlyArray<SearchResultRow>;
  readonly paging?: { readonly next?: { readonly after: string } };
}

export type SearchOutcome =
  | { readonly kind: 'ok'; readonly result: SearchResult }
  | { readonly kind: 'auth-failed' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string };

export async function searchObjects(params: SearchParams): Promise<SearchOutcome> {
  const url = `${params.baseUrl}/crm/v3/objects/${params.objectType}/search`;
  const body: Record<string, unknown> = {
    limit: params.limit,
    properties: params.properties,
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
  };
  if (params.after !== undefined) {
    body.after = params.after;
  }
  if (params.modifiedAfter !== null) {
    body.filterGroups = [
      {
        filters: [
          {
            propertyName: 'hs_lastmodifieddate',
            operator: 'GT',
            value: String(Date.parse(params.modifiedAfter)),
          },
        ],
      },
    ];
  }
  const res = await params.fetcher.fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
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
  const results = Array.isArray(j.results) ? (j.results as SearchResultRow[]) : [];
  const paging = (j.paging as SearchResult['paging']) ?? undefined;
  const result: SearchResult = paging !== undefined ? { results, paging } : { results };
  return { kind: 'ok', result };
}
