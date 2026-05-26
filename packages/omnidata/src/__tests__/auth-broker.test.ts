import { describe, it, expect, vi } from 'vitest';
import { createAuthBroker } from '../connector-base/auth-broker.js';
import type {
  AuthStoragePort,
  OAuth2Refresher,
  StoredOAuth2Credential,
} from '../connector-base/auth-broker.js';
import type { ClockPort } from '../types.js';

function makeStorage(initial: StoredOAuth2Credential | null): AuthStoragePort & { stored: StoredOAuth2Credential | null } {
  let stored = initial;
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (cred: StoredOAuth2Credential) => {
      stored = cred;
    }),
    get stored() {
      return stored;
    },
    set stored(v) {
      stored = v;
    },
  };
}

function makeClock(iso: string): ClockPort {
  return { nowIso: () => iso };
}

describe('createAuthBroker', () => {
  it('returns unconfigured when storage has no credential', async () => {
    const broker = createAuthBroker({
      storage: makeStorage(null),
      refresher: { refresh: vi.fn() },
      clock: makeClock('2026-05-26T00:00:00.000Z'),
    });
    const result = await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(result.kind).toBe('unconfigured');
  });

  it('returns the access token when it is fresh', async () => {
    const cred: StoredOAuth2Credential = {
      tenantId: 't1',
      connectorId: 'slack:t1',
      accessToken: 'fresh-token',
      refreshToken: 'refresh-1',
      expiresAt: '2026-05-26T01:00:00.000Z',
      scopes: ['channels:history'],
    };
    const broker = createAuthBroker({
      storage: makeStorage(cred),
      refresher: { refresh: vi.fn() },
      clock: makeClock('2026-05-26T00:00:00.000Z'),
    });
    const result = await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(result.kind).toBe('oauth2');
    if (result.kind === 'oauth2') {
      expect(result.accessToken).toBe('fresh-token');
    }
  });

  it('refreshes when the token is expired', async () => {
    const cred: StoredOAuth2Credential = {
      tenantId: 't1',
      connectorId: 'slack:t1',
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      expiresAt: '2026-05-25T23:00:00.000Z',
      scopes: ['channels:history'],
    };
    const storage = makeStorage(cred);
    const broker = createAuthBroker({
      storage,
      refresher: {
        refresh: vi.fn(async () => ({
          accessToken: 'new-token',
          refreshToken: 'refresh-2',
          expiresAt: '2026-05-26T01:00:00.000Z',
        })),
      },
      clock: makeClock('2026-05-26T00:00:00.000Z'),
    });
    const result = await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(result.kind).toBe('oauth2');
    if (result.kind === 'oauth2') {
      expect(result.accessToken).toBe('new-token');
      expect(result.refreshToken).toBe('refresh-2');
    }
    expect(storage.stored?.accessToken).toBe('new-token');
  });

  it('refreshes within the skew window', async () => {
    const cred: StoredOAuth2Credential = {
      tenantId: 't1',
      connectorId: 'slack:t1',
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      // expires 30s in the future — within the default 60s skew
      expiresAt: '2026-05-26T00:00:30.000Z',
      scopes: ['channels:history'],
    };
    const refresher: OAuth2Refresher = {
      refresh: vi.fn(async () => ({
        accessToken: 'new-token',
        refreshToken: 'refresh-2',
        expiresAt: '2026-05-26T01:00:00.000Z',
      })),
    };
    const broker = createAuthBroker({
      storage: makeStorage(cred),
      refresher,
      clock: makeClock('2026-05-26T00:00:00.000Z'),
    });
    await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(refresher.refresh).toHaveBeenCalled();
  });

  it('surfaces unconfigured when refresh throws', async () => {
    const cred: StoredOAuth2Credential = {
      tenantId: 't1',
      connectorId: 'slack:t1',
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      expiresAt: '2026-05-25T23:00:00.000Z',
      scopes: ['channels:history'],
    };
    const broker = createAuthBroker({
      storage: makeStorage(cred),
      refresher: {
        refresh: vi.fn(async () => {
          throw new Error('refresh failed');
        }),
      },
      clock: makeClock('2026-05-26T00:00:00.000Z'),
    });
    const result = await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(result.kind).toBe('unconfigured');
  });

  it('honours a custom skew', async () => {
    const cred: StoredOAuth2Credential = {
      tenantId: 't1',
      connectorId: 'slack:t1',
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      // expires 5 minutes in the future
      expiresAt: '2026-05-26T00:05:00.000Z',
      scopes: ['channels:history'],
    };
    const refresher: OAuth2Refresher = {
      refresh: vi.fn(async () => ({
        accessToken: 'new-token',
        refreshToken: 'refresh-2',
        expiresAt: '2026-05-26T01:00:00.000Z',
      })),
    };
    const broker = createAuthBroker({
      storage: makeStorage(cred),
      refresher,
      clock: makeClock('2026-05-26T00:00:00.000Z'),
      refreshSkewSeconds: 600, // 10 minutes — should refresh
    });
    await broker.resolve({ tenantId: 't1', connectorId: 'slack:t1' });
    expect(refresher.refresh).toHaveBeenCalled();
  });
});
