/**
 * OAuth token manager unit tests.
 *
 * Covers:
 *   - none auth bypasses the store
 *   - api_key returns the stored key
 *   - oauth_token within the safety margin triggers refresh
 *   - oauth_token outside margin returns the stored token
 *   - missing credentials throw
 *   - missing refresh token throws
 */
import { describe, expect, it } from 'vitest';
import {
  createOAuthTokenManager,
  type CredentialStore,
  type DecryptedCredentials,
  type OAuthRefresher,
} from '../auth/oauth-token-manager.js';
import { findCatalogEntry } from '../catalog/public-servers.js';
import type { McpCatalogEntry } from '../types.js';

const slack = findCatalogEntry('slack') as McpCatalogEntry;
const memory = findCatalogEntry('memory') as McpCatalogEntry;
const postgres = findCatalogEntry('postgres') as McpCatalogEntry;

function emptyStore(): CredentialStore {
  return {
    fetch: async () => null,
    persistRefreshed: async () => {},
  };
}

function fixedStore(creds: DecryptedCredentials): {
  readonly store: CredentialStore;
  readonly persistCalls: DecryptedCredentials[];
} {
  const persistCalls: DecryptedCredentials[] = [];
  return {
    store: {
      fetch: async () => creds,
      persistRefreshed: async (_t, _s, c) => {
        persistCalls.push(c);
      },
    },
    persistCalls,
  };
}

function noopRefresher(): OAuthRefresher {
  return {
    refresh: async () => {
      throw new Error('refresher should not be called in this test');
    },
  };
}

describe('oauth-token-manager', () => {
  it('returns mode=none for catalog entries with auth=none', async () => {
    const manager = createOAuthTokenManager({
      store: emptyStore(),
      refresher: noopRefresher(),
    });
    const ctx = await manager.getCredentialsForInvocation('tenant-1', memory);
    expect(ctx.mode).toBe('none');
    expect(ctx.accessToken).toBeUndefined();
  });

  it('returns api_key credentials for postgres', async () => {
    const { store } = fixedStore({
      mode: 'api_key',
      apiKey: 'postgresql://...',
    });
    const manager = createOAuthTokenManager({
      store,
      refresher: noopRefresher(),
    });
    const ctx = await manager.getCredentialsForInvocation(
      'tenant-1',
      postgres,
    );
    expect(ctx.mode).toBe('api_key');
    expect(ctx.apiKey).toBe('postgresql://...');
  });

  it('throws when no credentials are stored', async () => {
    const manager = createOAuthTokenManager({
      store: emptyStore(),
      refresher: noopRefresher(),
    });
    await expect(
      manager.getCredentialsForInvocation('tenant-1', slack),
    ).rejects.toThrow(/no credentials stored/);
  });

  it('returns the stored token when outside the refresh margin', async () => {
    const future = 5_000_000_000_000;
    const { store } = fixedStore({
      mode: 'oauth_token',
      accessToken: 'xoxb-stored',
      refreshToken: 'r1',
      expiresAt: future,
    });
    const manager = createOAuthTokenManager({
      store,
      refresher: noopRefresher(),
      now: () => future - 10 * 60 * 1000, // 10min before expiry
      refreshMarginMs: 5 * 60 * 1000,
    });
    const ctx = await manager.getCredentialsForInvocation('tenant-1', slack);
    expect(ctx.accessToken).toBe('xoxb-stored');
  });

  it('refreshes when inside the safety margin', async () => {
    const future = 5_000_000_000_000;
    const { store, persistCalls } = fixedStore({
      mode: 'oauth_token',
      accessToken: 'xoxb-old',
      refreshToken: 'r1',
      expiresAt: future,
    });
    const refresher: OAuthRefresher = {
      refresh: async (provider, refreshToken) => {
        expect(provider).toBe('slack');
        expect(refreshToken).toBe('r1');
        return {
          mode: 'oauth_token',
          accessToken: 'xoxb-new',
          refreshToken: 'r2',
          expiresAt: future + 3600_000,
        };
      },
    };
    const manager = createOAuthTokenManager({
      store,
      refresher,
      now: () => future - 60_000, // 1min before expiry, inside 5min margin
    });
    const ctx = await manager.getCredentialsForInvocation('tenant-1', slack);
    expect(ctx.accessToken).toBe('xoxb-new');
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]!.accessToken).toBe('xoxb-new');
  });

  it('throws when refresh is needed but refreshToken missing', async () => {
    const { store } = fixedStore({
      mode: 'oauth_token',
      accessToken: 'xoxb-old',
      expiresAt: 100,
    });
    const manager = createOAuthTokenManager({
      store,
      refresher: noopRefresher(),
      now: () => 100,
    });
    await expect(
      manager.getCredentialsForInvocation('tenant-1', slack),
    ).rejects.toThrow(/refreshToken missing/);
  });

  it('throws when oauth credentials lack accessToken', async () => {
    const { store } = fixedStore({
      mode: 'oauth_token',
      refreshToken: 'r',
      expiresAt: 5_000_000_000_000,
    });
    const manager = createOAuthTokenManager({
      store,
      refresher: noopRefresher(),
      now: () => 0,
    });
    await expect(
      manager.getCredentialsForInvocation('tenant-1', slack),
    ).rejects.toThrow(/missing accessToken/);
  });

  it('throws when api_key credentials lack apiKey', async () => {
    const { store } = fixedStore({ mode: 'api_key' });
    const manager = createOAuthTokenManager({
      store,
      refresher: noopRefresher(),
    });
    await expect(
      manager.getCredentialsForInvocation('tenant-1', postgres),
    ).rejects.toThrow(/missing apiKey/);
  });
});
