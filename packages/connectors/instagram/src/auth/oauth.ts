/**
 * Instagram OAuth2 (via Facebook Login).
 *
 * Reference: Instagram Graph API, *Authorization*,
 * https://developers.facebook.com/docs/facebook-login/guides/access-tokens,
 * accessed 2026-05-25.
 *
 * Two surfaces:
 *   - `buildAuthorizeUrl` — composes the 302 to facebook.com.
 *   - `exchangeCode`      — code -> short-lived token, then upgrades
 *                           to a long-lived page token (60 days).
 */

import type { FetcherPort, InstagramInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: InstagramInstall;
  readonly redirectUri: string;
  readonly state: string;
  /** Comma-separated; default scope is the minimum read set. */
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  /** Long-lived tokens carry no refresh token — re-auth on expiry. */
  readonly expiresAt: string;
  readonly tokenType: string;
}

const DEFAULT_SCOPE = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

const FB_AUTH_BASE = 'https://www.facebook.com/v18.0/dialog/oauth';
const FB_TOKEN_BASE = 'https://graph.facebook.com/v18.0/oauth/access_token';

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const u = new URL(FB_AUTH_BASE);
  u.searchParams.set('client_id', params.install.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  u.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

export interface OAuth2ExchangeParams {
  readonly install: InstagramInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const u = new URL(FB_TOKEN_BASE);
  u.searchParams.set('client_id', params.install.clientId);
  u.searchParams.set('client_secret', params.install.clientSecret);
  u.searchParams.set('code', params.code);
  u.searchParams.set('redirect_uri', params.redirectUri);

  const res = await params.fetcher.fetch(u.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (res.status !== 200) {
    throw new Error(`Instagram OAuth exchange failed: status ${res.status}`);
  }
  const text = await res.text();
  const json = JSON.parse(text) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (typeof json.access_token !== 'string') {
    throw new Error('Instagram OAuth response missing access_token');
  }
  const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return Object.freeze({
    accessToken: json.access_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
    tokenType: json.token_type ?? 'Bearer',
  });
}
