/**
 * GitLab OAuth 2.0.
 *
 * Reference: GitLab, *OAuth 2.0 Applications* —
 * https://docs.gitlab.com/ee/api/oauth2.html
 */

import type { FetcherPort, GitLabInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: GitLabInstall;
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
  readonly install: GitLabInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_SCOPE = 'read_api read_repository read_user';

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const base = params.install.baseUrl ?? 'https://gitlab.com';
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  return url.toString();
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const base = params.install.baseUrl ?? 'https://gitlab.com';
  const res = await params.fetcher.fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GitLab token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 7200;
  if (access === '') throw new Error('GitLab token response missing access_token');
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'bearer',
  };
}
