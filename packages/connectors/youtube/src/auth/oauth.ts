/**
 * Google OAuth2 for the YouTube Data API.
 *
 * Reference: Google Identity, *OAuth 2.0 for Web Server Apps*,
 * https://developers.google.com/identity/protocols/oauth2/web-server,
 * accessed 2026-05-25.
 *
 * Scopes (P2 read-only):
 *   - https://www.googleapis.com/auth/youtube.readonly
 *   - https://www.googleapis.com/auth/yt-analytics.readonly
 *
 * Access tokens: 1h. Refresh tokens never expire (until revoked).
 */

import type { FetcherPort, YouTubeInstall } from '../types.js';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_BASE = 'https://oauth2.googleapis.com/token';

const DEFAULT_SCOPE = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

export interface OAuth2AuthorizeParams {
  readonly install: YouTubeInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const u = new URL(AUTH_BASE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.install.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  u.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  // Required to obtain a refresh_token on first consent.
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export interface OAuth2ExchangeParams {
  readonly install: YouTubeInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
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
    throw new Error(`YouTube OAuth exchange failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string'
  ) {
    throw new Error('YouTube OAuth response missing tokens');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return Object.freeze({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
  });
}
