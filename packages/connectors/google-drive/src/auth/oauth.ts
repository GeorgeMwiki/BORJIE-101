/**
 * Google Drive OAuth 2.0 install + token-exchange.
 *
 * Reference: Google — "OAuth 2.0 for Web Server Applications"
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 *   (visited 2026-05-26).
 *
 * Tokens carry a 1-hour `expires_in`. `token-refresh.ts` handles the
 * 5-minute-ahead refresh.
 */

import type { EncryptedCredentialStore, Fetcher } from '../types.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const SCOPES_READONLY = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.activity.readonly',
] as const;

export interface DriveOAuthExchangeInput {
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface DriveTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly token_type: 'Bearer';
  readonly scope?: string;
}

export interface DriveCredentials {
  readonly tenantId: string;
  readonly account: string;
  readonly encryptedAccessToken: Uint8Array;
  readonly encryptedRefreshToken: Uint8Array;
  /** ISO timestamp — when access_token expires (per `expires_in`). */
  readonly expiresAt: string;
  readonly scopes: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface DriveInstallDeps {
  readonly fetcher: Fetcher;
  readonly store: EncryptedCredentialStore;
  readonly nowIso: () => string;
}

export async function exchangeDriveAuthCode(
  tenantId: string,
  account: string,
  input: DriveOAuthExchangeInput,
  deps: DriveInstallDeps,
): Promise<DriveCredentials> {
  if (input.code.length === 0) {
    throw new Error('OAuth code must be non-empty');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  });
  const req = new Request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const res = await deps.fetcher(req);
  if (!res.ok) {
    throw new Error(`Google Drive token exchange failed: ${res.status}`);
  }
  const payload = (await res.json()) as DriveTokenResponse;
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('Google Drive token response missing fields');
  }
  const nowIso = deps.nowIso();
  const expiresAt = new Date(
    Date.parse(nowIso) + payload.expires_in * 1000,
  ).toISOString();
  const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
    deps.store.seal(payload.access_token),
    deps.store.seal(payload.refresh_token),
  ]);
  return {
    tenantId,
    account,
    encryptedAccessToken,
    encryptedRefreshToken,
    expiresAt,
    scopes: payload.scope
      ? payload.scope.split(' ').filter((s) => s.length > 0)
      : [...SCOPES_READONLY],
    createdAt: nowIso,
  };
}
