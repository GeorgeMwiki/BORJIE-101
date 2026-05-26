import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type {
  EncryptedTokenStoragePort,
} from '../auth/token-refresh.js';
import type { FetcherPort, InstagramInstall } from '../types.js';

const install: InstagramInstall = Object.freeze({
  tenantId: 'tenant-a',
  account: 'ig-bus-1',
  clientId: 'fb-client',
  clientSecret: 'fb-secret',
});

function makeFetcher(
  responder: (url: string) => { status: number; body: string },
): FetcherPort {
  return Object.freeze({
    fetch: async (url) => {
      const { status, body } = responder(url);
      return {
        status,
        headers: {},
        text: async () => body,
      };
    },
  });
}

describe('buildAuthorizeUrl', () => {
  it('includes client_id, redirect_uri, state and the default scope', () => {
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/oauth/instagram',
        state: 's-1',
      }),
    );
    expect(u.searchParams.get('client_id')).toBe('fb-client');
    expect(u.searchParams.get('state')).toBe('s-1');
    expect(u.searchParams.get('scope')).toContain('instagram_basic');
  });
});

describe('exchangeCode', () => {
  it('parses access_token + expires_in from the response', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    }));
    const out = await exchangeCode({
      install,
      code: 'c1',
      redirectUri: 'https://app.borjie.ai/cb',
      fetcher,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.accessToken).toBe('tok-1');
    expect(out.expiresAt).toBe('2026-05-26T11:00:00.000Z');
  });
});

describe('refreshAccessToken', () => {
  it('persists the rotated token on success', async () => {
    const saved: Array<{ accessToken: string; expiresAt: string }> = [];
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async (_tenant, creds) => {
        saved.push(creds);
      },
      markAuthFailed: async () => undefined,
    });
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-new',
        expires_in: 5184000,
      }),
    }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'c',
      clientSecret: 's',
      currentToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.status).toBe('ok');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.accessToken).toBe('tok-new');
  });

  it('marks auth-failed on 401', async () => {
    let marked = false;
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async () => undefined,
      markAuthFailed: async () => {
        marked = true;
      },
    });
    const fetcher = makeFetcher(() => ({ status: 401, body: '' }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'c',
      clientSecret: 's',
      currentToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.now(),
    });
    expect(out.status).toBe('auth-failed');
    expect(marked).toBe(true);
  });
});
