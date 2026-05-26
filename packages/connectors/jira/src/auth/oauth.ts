/**
 * Atlassian OAuth 2.0 (3LO).
 *
 * Reference: Atlassian, *OAuth 2.0 (3LO) apps* —
 * https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
 */

import type { FetcherPort, JiraInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: JiraInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
  readonly audience?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
}

export interface OAuth2ExchangeParams {
  readonly install: JiraInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_SCOPE = 'read:jira-work read:jira-user offline_access';

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL('https://auth.atlassian.com/authorize');
  url.searchParams.set('audience', params.audience ?? 'api.atlassian.com');
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = {
    grant_type: 'authorization_code',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  };
  const res = await params.fetcher.fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Jira token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  if (access === '' || refresh === '') {
    throw new Error('Jira token response missing required fields');
  }
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}
