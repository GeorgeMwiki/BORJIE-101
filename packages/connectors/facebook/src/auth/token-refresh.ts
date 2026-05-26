/**
 * Facebook long-lived page token refresh — same surface as Instagram.
 *
 * Reference: Meta, *Long-Lived Tokens*,
 * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

export interface EncryptedTokenStoragePort {
  readonly load: (tenantId: string) => Promise<{
    readonly accessToken: string;
    readonly expiresAt: string;
  } | null>;
  readonly save: (
    tenantId: string,
    creds: { readonly accessToken: string; readonly expiresAt: string },
  ) => Promise<void>;
  readonly markAuthFailed: (tenantId: string) => Promise<void>;
}

export interface RefreshTokenParams {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly currentToken: string;
  readonly fetcher: FetcherPort;
  readonly storage: EncryptedTokenStoragePort;
  readonly nowMs: () => number;
}

export interface RefreshOutcome {
  readonly status: 'ok' | 'auth-failed';
  readonly accessToken?: string;
  readonly expiresAt?: string;
}

const FB_TOKEN_REFRESH = 'https://graph.facebook.com/v18.0/oauth/access_token';

export async function refreshAccessToken(
  params: RefreshTokenParams,
): Promise<RefreshOutcome> {
  const u = new URL(FB_TOKEN_REFRESH);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('client_secret', params.clientSecret);
  u.searchParams.set('fb_exchange_token', params.currentToken);

  const res = await params.fetcher.fetch(u.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 400) {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'auth-failed' });
  }
  if (res.status !== 200) {
    throw new Error(`Facebook token refresh failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (typeof json.access_token !== 'string') {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'auth-failed' });
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 5184000;
  const expiresAt = new Date(
    params.nowMs() + expiresInSec * 1000,
  ).toISOString();
  await params.storage.save(params.tenantId, {
    accessToken: json.access_token,
    expiresAt,
  });
  return Object.freeze({
    status: 'ok',
    accessToken: json.access_token,
    expiresAt,
  });
}
