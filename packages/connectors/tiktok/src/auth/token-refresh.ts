/**
 * TikTok Business API token refresh.
 *
 * Reference: TikTok, *Token Refresh*,
 * https://business-api.tiktok.com/portal/docs?id=1738373164380162,
 * accessed 2026-05-25.
 */

import type { FetcherPort } from '../types.js';

const TOKEN_BASE = 'https://open.tiktokapis.com/v2/oauth/token/';

export interface EncryptedTokenStoragePort {
  readonly load: (tenantId: string) => Promise<{
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: string;
  } | null>;
  readonly save: (
    tenantId: string,
    creds: {
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt: string;
    },
  ) => Promise<void>;
  readonly markAuthFailed: (tenantId: string) => Promise<void>;
}

export interface RefreshTokenParams {
  readonly tenantId: string;
  readonly clientKey: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly fetcher: FetcherPort;
  readonly storage: EncryptedTokenStoragePort;
  readonly nowMs: () => number;
}

export interface RefreshOutcome {
  readonly status: 'ok' | 'auth-failed';
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
}

export async function refreshAccessToken(
  params: RefreshTokenParams,
): Promise<RefreshOutcome> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
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
    throw new Error(`TikTok token refresh failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string'
  ) {
    await params.storage.markAuthFailed(params.tenantId);
    return Object.freeze({ status: 'auth-failed' });
  }
  const expiresAt = new Date(
    params.nowMs() +
      (typeof json.expires_in === 'number' ? json.expires_in : 86400) * 1000,
  ).toISOString();
  await params.storage.save(params.tenantId, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt,
  });
  return Object.freeze({
    status: 'ok',
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt,
  });
}
