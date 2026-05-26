/**
 * Auth broker — central place that fetches and refreshes OAuth tokens
 * for an `OmnidataConnector`. Concrete connectors never hold tokens in
 * memory; they receive an `OmnidataAuthContext` at sync time.
 *
 * The production wiring talks to Supabase Vault for storage. The
 * factory here is dependency-injectable so unit tests pass an
 * in-memory store and a deterministic clock.
 */

import type { ClockPort, OmnidataAuthContext } from '../types.js';

export interface StoredOAuth2Credential {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string; // ISO
  readonly scopes: ReadonlyArray<string>;
}

export interface OAuth2RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export interface AuthStoragePort {
  readonly load: (params: {
    readonly tenantId: string;
    readonly connectorId: string;
  }) => Promise<StoredOAuth2Credential | null>;
  readonly save: (cred: StoredOAuth2Credential) => Promise<void>;
}

export interface OAuth2Refresher {
  readonly refresh: (params: {
    readonly tenantId: string;
    readonly connectorId: string;
    readonly refreshToken: string;
  }) => Promise<OAuth2RefreshResult>;
}

export interface AuthBrokerDeps {
  readonly storage: AuthStoragePort;
  readonly refresher: OAuth2Refresher;
  readonly clock: ClockPort;
  readonly refreshSkewSeconds?: number; // default 60
}

export interface AuthBroker {
  readonly resolve: (params: {
    readonly tenantId: string;
    readonly connectorId: string;
  }) => Promise<OmnidataAuthContext>;
}

/**
 * Pure factory. The broker resolves a credential, refreshes if it is
 * expired (or within the skew window), persists the rotation, and
 * returns the fresh `OmnidataAuthContext`. Refresh failures surface as
 * `{ kind: 'unconfigured' }` so the orchestrator can short-circuit
 * the sync.
 */
export function createAuthBroker(deps: AuthBrokerDeps): AuthBroker {
  const skewSeconds = deps.refreshSkewSeconds ?? 60;

  function nowMs(): number {
    return Date.parse(deps.clock.nowIso());
  }

  function isExpired(expiresAt: string): boolean {
    const expiry = Date.parse(expiresAt);
    return Number.isFinite(expiry) ? expiry - nowMs() <= skewSeconds * 1000 : true;
  }

  async function resolve(params: { readonly tenantId: string; readonly connectorId: string }): Promise<OmnidataAuthContext> {
    const cred = await deps.storage.load(params);
    if (!cred) {
      return { kind: 'unconfigured' };
    }

    if (!isExpired(cred.expiresAt)) {
      return {
        kind: 'oauth2',
        accessToken: cred.accessToken,
        refreshToken: cred.refreshToken,
        expiresAt: cred.expiresAt,
      };
    }

    try {
      const refreshed = await deps.refresher.refresh({
        tenantId: params.tenantId,
        connectorId: params.connectorId,
        refreshToken: cred.refreshToken,
      });
      const next: StoredOAuth2Credential = {
        ...cred,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      await deps.storage.save(next);
      return {
        kind: 'oauth2',
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
      };
    } catch {
      return { kind: 'unconfigured' };
    }
  }

  return { resolve };
}
