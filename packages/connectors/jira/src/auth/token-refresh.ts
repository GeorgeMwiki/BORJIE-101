/**
 * Atlassian OAuth refresh.
 */

import type { FetcherPort, JiraInstall } from '../types.js';
import type { OAuth2TokenResult } from './oauth.js';

export interface RefreshTokenParams {
  readonly install: JiraInstall;
  readonly refreshToken: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export interface EncryptedTokenStoragePort {
  readonly load: (params: {
    readonly tenantId: string;
    readonly account: string;
  }) => Promise<{ readonly refreshToken: string } | null>;
  readonly save: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly token: OAuth2TokenResult;
  }) => Promise<void>;
}

export async function refreshAccessToken(
  params: RefreshTokenParams,
): Promise<OAuth2TokenResult> {
  const body = {
    grant_type: 'refresh_token',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    refresh_token: params.refreshToken,
  };
  const res = await params.fetcher.fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Jira refresh failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  if (access === '') throw new Error('Jira refresh response missing access_token');
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : params.refreshToken;
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}
