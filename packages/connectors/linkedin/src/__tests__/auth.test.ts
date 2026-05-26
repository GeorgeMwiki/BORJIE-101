import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import {
  refreshAccessToken,
  type EncryptedTokenStoragePort,
} from '../auth/token-refresh.js';
import type { FetcherPort, LinkedInInstall } from '../types.js';

const install: LinkedInInstall = Object.freeze({
  tenantId: 'tenant-a',
  account: 'urn:li:organization:1234567',
  clientId: 'li-client',
  clientSecret: 'li-secret',
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

describe('LinkedIn buildAuthorizeUrl', () => {
  it('includes client_id + scopes + state', () => {
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/oauth/linkedin',
        state: 's-1',
      }),
    );
    expect(u.searchParams.get('client_id')).toBe('li-client');
    expect(u.searchParams.get('state')).toBe('s-1');
    expect(u.searchParams.get('scope')).toContain('r_organization_social');
    expect(u.searchParams.get('scope') ?? '').not.toContain('w_member_social');
  });
});

describe('LinkedIn exchangeCode', () => {
  it('parses access_token + (optional) refresh_token + expires_in', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        expires_in: 5184000,
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
    expect(out.refreshToken).toBeNull();
  });

  it('parses partner-tier responses that include a refresh_token', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        refresh_token: 'ref-1',
        expires_in: 5184000,
      }),
    }));
    const out = await exchangeCode({
      install,
      code: 'c1',
      redirectUri: 'https://app.borjie.ai/cb',
      fetcher,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.refreshToken).toBe('ref-1');
  });
});

describe('LinkedIn refreshAccessToken', () => {
  it('returns no-refresh-token + marks auth-failed when refreshToken is null', async () => {
    let marked = false;
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async () => undefined,
      markAuthFailed: async () => {
        marked = true;
      },
    });
    const fetcher = makeFetcher(() => ({ status: 200, body: '{}' }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'li-client',
      clientSecret: 'li-secret',
      refreshToken: null,
      fetcher,
      storage,
      nowMs: () => 0,
    });
    expect(out.status).toBe('no-refresh-token');
    expect(marked).toBe(true);
  });

  it('persists rotated tokens on success', async () => {
    const saved: Array<{ accessToken: string }> = [];
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async (_t, creds) => {
        saved.push({ accessToken: creds.accessToken });
      },
      markAuthFailed: async () => undefined,
    });
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-new',
        refresh_token: 'ref-new',
        expires_in: 5184000,
      }),
    }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'li-client',
      clientSecret: 'li-secret',
      refreshToken: 'old',
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
    const fetcher = makeFetcher(() => ({ status: 401, body: '' }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'li-client',
      clientSecret: 'li-secret',
      refreshToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.now(),
    });
    expect(out.status).toBe('auth-failed');
    expect(marked).toBe(true);
  });
});
