/**
 * GitHub OAuth 2.0 — Web Application Flow.
 *
 * Reference: GitHub, *Authorizing OAuth apps* —
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 */

import type { FetcherPort, GitHubInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: GitHubInstall;
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
  readonly install: GitHubInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_SCOPE = 'repo read:org';
const DEFAULT_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours for GitHub user-to-server

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  return url.toString();
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const res = await params.fetcher.fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GitHub token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn =
    typeof json.expires_in === 'number' ? json.expires_in * 1000 : DEFAULT_LIFETIME_MS;
  if (access === '') throw new Error('GitHub token response missing access_token');
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'bearer',
  };
}
