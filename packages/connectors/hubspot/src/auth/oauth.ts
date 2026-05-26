/**
 * HubSpot OAuth 2.0 — Authorization Code grant.
 *
 * Reference: HubSpot, *OAuth 2.0 Authentication* —
 * https://developers.hubspot.com/docs/api/working-with-oauth
 */

import type { FetcherPort, HubSpotInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: HubSpotInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
}

export interface OAuth2ExchangeParams {
  readonly install: HubSpotInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_SCOPE =
  'crm.objects.contacts.read crm.objects.deals.read tickets content';

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL('https://app.hubspot.com/oauth/authorize');
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  url.searchParams.set('state', params.state);
  return url.toString();
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const baseUrl = params.install.baseUrl ?? 'https://api.hubapi.com';
  const res = await params.fetcher.fetch(`${baseUrl}/oauth/v1/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HubSpot token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 21600;
  const tokenType = typeof json.token_type === 'string' ? json.token_type : 'bearer';
  if (access === '' || refresh === '') {
    throw new Error('HubSpot token response missing required fields');
  }
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType,
  };
}
