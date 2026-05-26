/**
 * LinkedIn OAuth2 (3-legged).
 *
 * Reference: Microsoft Learn, *LinkedIn 3-legged OAuth*,
 * https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow,
 * accessed 2026-05-25.
 *
 * Scopes (P2 read-only):
 *   - r_organization_social
 *   - r_organization_admin
 */

import type { FetcherPort, LinkedInInstall } from '../types.js';

const AUTH_BASE = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_BASE = 'https://www.linkedin.com/oauth/v2/accessToken';

const DEFAULT_SCOPE = ['r_organization_social', 'r_organization_admin'].join(
  ' ',
);

export interface OAuth2AuthorizeParams {
  readonly install: LinkedInInstall;
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
  return u.toString();
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly refreshToken: string | null;
}

export interface OAuth2ExchangeParams {
  readonly install: LinkedInInstall;
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
    throw new Error(`LinkedIn OAuth exchange failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (typeof json.access_token !== 'string') {
    throw new Error('LinkedIn OAuth response missing access_token');
  }
  // Non-partner tier: 60-day access token, no refresh token.
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 5184000;
  return Object.freeze({
    accessToken: json.access_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
    refreshToken: json.refresh_token ?? null,
  });
}
