/**
 * Per-tenant OAuth token manager.
 *
 * Wraps a pluggable encrypted store so the client never holds plaintext
 * tokens longer than one invocation. The actual storage (Postgres
 * `mcp_external_connections.encrypted_credentials`, AES-GCM with a
 * tenant-bound DEK from KMS) lives in the database package; this module
 * is the in-process facade.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §4.
 */

import type {
  McpAuthContext,
  McpAuthMode,
  McpCatalogEntry,
} from '../types.js';

/** Persisted credentials shape after decryption by the store layer. */
export interface DecryptedCredentials {
  readonly mode: McpAuthMode;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly apiKey?: string;
  readonly expiresAt?: number;
  readonly scopes?: ReadonlyArray<string>;
}

/** Adapter contract the manager talks to. Drizzle/DB lives behind this. */
export interface CredentialStore {
  readonly fetch: (
    tenantId: string,
    serverId: string,
  ) => Promise<DecryptedCredentials | null>;
  readonly persistRefreshed: (
    tenantId: string,
    serverId: string,
    creds: DecryptedCredentials,
  ) => Promise<void>;
}

/** Adapter contract for the OAuth refresh endpoint per provider. */
export interface OAuthRefresher {
  readonly refresh: (
    provider: string,
    refreshToken: string,
  ) => Promise<DecryptedCredentials>;
}

export interface OAuthTokenManagerDeps {
  readonly store: CredentialStore;
  readonly refresher: OAuthRefresher;
  /** Test-only injection point. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Safety margin in ms before expiry (default 5min). */
  readonly refreshMarginMs?: number;
}

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * `getCredentialsForInvocation(tenantId, serverId)` is the single entry
 * point the client uses at call time. Refreshes on demand if the access
 * token is within the safety margin of expiry.
 */
export function createOAuthTokenManager(
  deps: OAuthTokenManagerDeps,
): {
  readonly getCredentialsForInvocation: (
    tenantId: string,
    entry: McpCatalogEntry,
  ) => Promise<McpAuthContext>;
} {
  const now = deps.now ?? Date.now;
  const margin = deps.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;

  async function getCredentialsForInvocation(
    tenantId: string,
    entry: McpCatalogEntry,
  ): Promise<McpAuthContext> {
    if (entry.auth === 'none') {
      return Object.freeze({
        tenantId,
        serverId: entry.id,
        mode: 'none' as const,
      });
    }

    const stored = await deps.store.fetch(tenantId, entry.id);
    if (stored === null) {
      throw new Error(
        `mcp-external-client: no credentials stored for tenant=${tenantId} server=${entry.id}`,
      );
    }

    if (stored.mode === 'api_key') {
      if (!stored.apiKey) {
        throw new Error(
          `mcp-external-client: api_key credentials missing apiKey field`,
        );
      }
      return Object.freeze({
        tenantId,
        serverId: entry.id,
        mode: 'api_key' as const,
        apiKey: stored.apiKey,
      });
    }

    // oauth_token / oauth_pkce — refresh if near expiry.
    const expiresAt = stored.expiresAt ?? 0;
    const needsRefresh = expiresAt > 0 && now() + margin >= expiresAt;
    let creds = stored;
    if (needsRefresh) {
      if (!stored.refreshToken) {
        throw new Error(
          `mcp-external-client: cannot refresh — refreshToken missing`,
        );
      }
      const provider = entry.oauthProvider ?? entry.id;
      creds = await deps.refresher.refresh(provider, stored.refreshToken);
      await deps.store.persistRefreshed(tenantId, entry.id, creds);
    }

    if (!creds.accessToken) {
      throw new Error(
        `mcp-external-client: oauth credentials missing accessToken`,
      );
    }

    const result: McpAuthContext = creds.expiresAt
      ? Object.freeze({
          tenantId,
          serverId: entry.id,
          mode: entry.auth,
          accessToken: creds.accessToken,
          expiresAt: creds.expiresAt,
        })
      : Object.freeze({
          tenantId,
          serverId: entry.id,
          mode: entry.auth,
          accessToken: creds.accessToken,
        });
    return result;
  }

  return Object.freeze({ getCredentialsForInvocation });
}
