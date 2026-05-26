/**
 * TikTok Business API OAuth2 (Login Kit for TikTok for Business).
 *
 * Reference: TikTok, *OAuth 2.0 / Authorization*,
 * https://business-api.tiktok.com/portal/docs?id=1738373164380162,
 * accessed 2026-05-25.
 */

import type { FetcherPort, TikTokInstall } from '../types.js';

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize';
const TOKEN_BASE = 'https://open.tiktokapis.com/v2/oauth/token/';

const DEFAULT_SCOPE = 'user.info.basic,video.list,video.insights';

export interface OAuth2AuthorizeParams {
  readonly install: TikTokInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly refreshExpiresAt: string;
  readonly openId: string;
}

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const u = new URL(AUTH_BASE);
  u.searchParams.set('client_key', params.install.clientKey);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  u.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

export interface OAuth2ExchangeParams {
  readonly install: TikTokInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    client_key: params.install.clientKey,
    client_secret: params.install.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });
  const res = await params.fetcher.fetch(TOKEN_BASE, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status !== 200) {
    throw new Error(`TikTok OAuth exchange failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    open_id?: string;
  };
  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string'
  ) {
    throw new Error('TikTok OAuth response missing tokens');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 86400;
  const refreshExpiresInSec =
    typeof json.refresh_expires_in === 'number'
      ? json.refresh_expires_in
      : 31536000;
  return Object.freeze({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
    refreshExpiresAt: new Date(
      params.nowMs() + refreshExpiresInSec * 1000,
    ).toISOString(),
    openId: json.open_id ?? '',
  });
}
