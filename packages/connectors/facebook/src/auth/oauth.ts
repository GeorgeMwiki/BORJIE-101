/**
 * Facebook OAuth2 — shared broker with Instagram.
 *
 * Reference: Meta, *Facebook Login for the Web*,
 * https://developers.facebook.com/docs/facebook-login/web,
 * accessed 2026-05-25.
 */

import type { FacebookInstall, FetcherPort } from '../types.js';

const FB_AUTH_BASE = 'https://www.facebook.com/v18.0/dialog/oauth';
const FB_TOKEN_BASE = 'https://graph.facebook.com/v18.0/oauth/access_token';

const DEFAULT_SCOPE = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'read_insights',
].join(',');

export interface OAuth2AuthorizeParams {
  readonly install: FacebookInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
}

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
  readonly install: FacebookInstall;
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
    throw new Error(`Facebook OAuth exchange failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (typeof json.access_token !== 'string') {
    throw new Error('Facebook OAuth response missing access_token');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return Object.freeze({
    accessToken: json.access_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
    tokenType: json.token_type ?? 'Bearer',
  });
}
