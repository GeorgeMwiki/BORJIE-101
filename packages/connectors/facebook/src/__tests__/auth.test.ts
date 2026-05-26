import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { EncryptedTokenStoragePort } from '../auth/token-refresh.js';
import type { FacebookInstall, FetcherPort } from '../types.js';

const install: FacebookInstall = Object.freeze({
  tenantId: 'tenant-a',
  account: 'page-1',
  clientId: 'fb-client',
  clientSecret: 'fb-secret',
});

function fetcherFor(
  responder: () => { status: number; body: string },
): FetcherPort {
  return Object.freeze({
    fetch: async () => {
      const { status, body } = responder();
      return { status, headers: {}, text: async () => body };
    },
  });
}

describe('buildAuthorizeUrl', () => {
  it('includes default scopes for Page read', () => {
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/cb',
        state: 'state',
      }),
    );
    expect(u.searchParams.get('scope')).toContain('pages_show_list');
    expect(u.searchParams.get('scope')).toContain('pages_read_engagement');
  });
});

describe('exchangeCode', () => {
  it('returns access_token and expires_at', async () => {
    const fetcher = fetcherFor(() => ({
      status: 200,
      body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
    }));
    const out = await exchangeCode({
      install,
      code: 'c',
      redirectUri: 'https://app.borjie.ai/cb',
      fetcher,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.accessToken).toBe('tok');
    expect(out.expiresAt).toBe('2026-05-26T11:00:00.000Z');
  });
});

describe('refreshAccessToken', () => {
  it('persists rotated long-lived token', async () => {
    const saved: Array<{ accessToken: string; expiresAt: string }> = [];
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async (_t, c) => {
        saved.push(c);
      },
      markAuthFailed: async () => undefined,
    });
    const fetcher = fetcherFor(() => ({
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
    const fetcher = fetcherFor(() => ({ status: 401, body: '' }));
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
