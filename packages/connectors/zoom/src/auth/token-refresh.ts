/**
 * Zoom S2S does not issue refresh tokens. The "refresh" port for Zoom
 * is implemented by re-running the account_credentials grant when the
 * cached token is past `expiresAt - skew`.
 *
 * The `EncryptedTokenStoragePort` exists so production composition
 * roots cache the (encrypted-at-rest) most recent token to amortise
 * the HTTPS roundtrip across pollers.
 */

import { fetchAccountAccessToken, type OAuth2TokenResult } from './oauth.js';
import type { FetcherPort, ZoomInstall } from '../types.js';

export interface RefreshTokenParams {
  readonly install: ZoomInstall;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export interface EncryptedTokenStoragePort {
  readonly load: (params: {
    readonly tenantId: string;
    readonly account: string;
  }) => Promise<{ readonly accessToken: string; readonly expiresAt: string } | null>;
  readonly save: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly token: OAuth2TokenResult;
  }) => Promise<void>;
}

export type RefreshOutcome =
  | { readonly kind: 'token'; readonly token: OAuth2TokenResult }
  | { readonly kind: 'cached'; readonly accessToken: string; readonly expiresAt: string }
  | { readonly kind: 'unconfigured' };

const SKEW_MS = 60_000; // refresh 60s before expiry

export async function getOrRefreshAccessToken(
  params: RefreshTokenParams,
  cache?: EncryptedTokenStoragePort,
): Promise<RefreshOutcome> {
  if (params.install.clientId === '' || params.install.clientSecret === '') {
    return { kind: 'unconfigured' };
  }
  if (cache !== undefined) {
    const cached = await cache.load({
      tenantId: params.install.tenantId,
      account: params.install.account,
    });
    if (cached !== null) {
      const expMs = Date.parse(cached.expiresAt);
      if (Number.isFinite(expMs) && expMs - params.nowMs() > SKEW_MS) {
        return { kind: 'cached', accessToken: cached.accessToken, expiresAt: cached.expiresAt };
      }
    }
  }
  const token = await fetchAccountAccessToken({
    install: params.install,
    fetcher: params.fetcher,
    nowMs: params.nowMs,
  });
  if (cache !== undefined) {
    await cache.save({
      tenantId: params.install.tenantId,
      account: params.install.account,
      token,
    });
  }
  return { kind: 'token', token };
}
