/**
 * LinkedIn token refresh (partner tier only).
 *
 * Reference: Microsoft Learn, *Refresh Tokens with OAuth 2.0*,
 * https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens,
 * accessed 2026-05-25.
 *
 * Non-partner tenants do *not* receive a refresh_token at /accessToken;
 * for them this function is a no-op that always returns auth-failed
 * once the 60-day window expires.
 */

import type { FetcherPort } from '../types.js';

const TOKEN_BASE = 'https://www.linkedin.com/oauth/v2/accessToken';

export interface EncryptedTokenStoragePort {
  readonly load: (tenantId: string) => Promise<{
    readonly accessToken: string;
    readonly refreshToken: string | null;
    readonly expiresAt: string;
  } | null>;
  readonly save: (
    tenantId: string,
    creds: {
      readonly accessToken: string;
      readonly refreshToken: string | null;
      readonly expiresAt: string;
    },
  ) => Promise<void>;
  readonly markAuthFailed: (tenantId: string) => Promise<void>;
}

export interface RefreshTokenParams {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string | null;
  readonly fetcher: FetcherPort;
  readonly storage: EncryptedTokenStoragePort;
  readonly nowMs: () => number;
}

export interface RefreshOutcome {
  readonly status: 'ok' | 'auth-failed' | 'no-refresh-token';
  readonly accessToken?: string;
  readonly refreshToken?: string | null;
  readonly expiresAt?: string;
}

export async function refreshAccessToken(
  params: RefreshTokenParams,
): Promise<RefreshOutcome> {
  if (params.refreshToken === null) {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'no-refresh-token' });
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await params.fetcher.fetch(TOKEN_BASE, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status === 401 || res.status === 400) {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'auth-failed' });
  }
  if (res.status !== 200) {
    throw new Error(`LinkedIn token refresh failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (typeof json.access_token !== 'string') {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'auth-failed' });
  }
  const expiresAt = new Date(
    params.nowMs() +
      (typeof json.expires_in === 'number' ? json.expires_in : 5184000) *
        1000,
  ).toISOString();
  const newRefresh = json.refresh_token ?? params.refreshToken;
  await params.storage.save(params.tenantId, {
    accessToken: json.access_token,
    refreshToken: newRefresh,
    expiresAt,
  });
  return Object.freeze({
    status: 'ok',
    accessToken: json.access_token,
    refreshToken: newRefresh,
    expiresAt,
  });
}
