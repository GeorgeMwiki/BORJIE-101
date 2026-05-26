/**
 * Linear OAuth 2.0.
 *
 * Reference: Linear, *OAuth Authentication* —
 * https://developers.linear.app/docs/oauth/authentication
 */

import type { FetcherPort, LinearInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: LinearInstall;
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
  readonly install: LinearInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000; // Linear access tokens long-lived

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL('https://linear.app/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scope ?? 'read');
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
  const res = await params.fetcher.fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Linear token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn =
    typeof json.expires_in === 'number'
      ? json.expires_in * 1000
      : DEFAULT_LIFETIME_MS;
  if (access === '') {
    throw new Error('Linear token response missing access_token');
  }
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}
