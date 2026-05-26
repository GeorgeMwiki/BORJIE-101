/**
 * Google Drive token refresh.
 *
 * Refresh 5 minutes ahead of `expiresAt` through the
 * `oauth2.googleapis.com/token` endpoint. On rejection, surface
 * `auth-failed` so the orchestrator can quarantine the connector.
 *
 * Reference: Google — "OAuth 2.0 — Refresh tokens"
 *   https://developers.google.com/identity/protocols/oauth2/web-server#offline
 *   (visited 2026-05-26).
 */

import type { EncryptedCredentialStore, Fetcher } from '../types.js';
import { TOKEN_URL, type DriveCredentials } from './oauth.js';

const SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface DriveRefreshInput {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface DriveRefreshDeps {
  readonly fetcher: Fetcher;
  readonly store: EncryptedCredentialStore;
  readonly nowIso: () => string;
}

export type DriveRefreshOutcome =
  | { readonly kind: 'fresh'; readonly credentials: DriveCredentials }
  | { readonly kind: 'refreshed'; readonly credentials: DriveCredentials }
  | { readonly kind: 'auth-failed'; readonly status: number };

export async function refreshDriveAccessToken(
  existing: DriveCredentials,
  input: DriveRefreshInput,
  deps: DriveRefreshDeps,
): Promise<DriveRefreshOutcome> {
  const now = Date.parse(deps.nowIso());
  const expiry = Date.parse(existing.expiresAt);
  if (now + SAFETY_MARGIN_MS < expiry) {
    return { kind: 'fresh', credentials: existing };
  }
  const refreshTokenPlain = await deps.store.open(existing.encryptedRefreshToken);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenPlain,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  const req = new Request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const res = await deps.fetcher(req);
  if (res.status === 400 || res.status === 401) {
    return { kind: 'auth-failed', status: res.status };
  }
  if (!res.ok) {
    return { kind: 'auth-failed', status: res.status };
  }
  const payload = (await res.json()) as {
    readonly access_token: string;
    readonly expires_in: number;
    readonly token_type: 'Bearer';
  };
  if (!payload.access_token) {
    return { kind: 'auth-failed', status: 0 };
  }
  const expiresAt = new Date(
    Date.parse(deps.nowIso()) + payload.expires_in * 1000,
  ).toISOString();
  const encryptedAccessToken = await deps.store.seal(payload.access_token);
  return {
    kind: 'refreshed',
    credentials: {
      ...existing,
      encryptedAccessToken,
      expiresAt,
    },
  };
}
