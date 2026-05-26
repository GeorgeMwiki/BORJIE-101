/**
 * Linear OAuth refresh.
 *
 * Linear's access tokens are long-lived; refresh is offered for apps
 * that opt in via the `actor=user` token flow. The function exists
 * here for forward-compat and broker symmetry.
 */

import type { FetcherPort, LinearInstall } from '../types.js';
import type { OAuth2TokenResult } from './oauth.js';

export interface RefreshTokenParams {
  readonly install: LinearInstall;
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
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    refresh_token: params.refreshToken,
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
    throw new Error(`Linear refresh failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  if (access === '') throw new Error('Linear refresh response missing access_token');
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : params.refreshToken;
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}
