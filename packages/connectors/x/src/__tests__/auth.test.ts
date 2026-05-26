import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
} from '../auth/oauth.js';
import {
  refreshAccessToken,
  type EncryptedTokenStoragePort,
} from '../auth/token-refresh.js';
import type { FetcherPort, XInstall } from '../types.js';

const install: XInstall = Object.freeze({
  tenantId: 'tenant-a',
  account: '12345',
  clientId: 'x-client',
  clientSecret: 'x-secret',
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

describe('X generatePkce', () => {
  it('emits a base64url verifier + SHA-256(verifier) challenge', () => {
    const pair = generatePkce();
    // base64url: no '=', no '+', no '/'.
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.codeVerifier).not.toBe(pair.codeChallenge);
  });
});

describe('X buildAuthorizeUrl', () => {
  it('includes PKCE + state + read-only scopes', () => {
    const pkce = generatePkce();
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/oauth/x',
        state: 's-1',
        pkce,
      }),
    );
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('x-client');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
    expect(u.searchParams.get('scope')).toContain('tweet.read');
    expect(u.searchParams.get('scope')).toContain('offline.access');
    expect(u.searchParams.get('scope') ?? '').not.toContain('tweet.write');
  });
});

describe('X exchangeCode', () => {
  it('parses access + refresh tokens + expires_in', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        refresh_token: 'ref-1',
        token_type: 'bearer',
        expires_in: 7200,
      }),
    }));
    const out = await exchangeCode({
      install,
      code: 'c1',
      redirectUri: 'https://app.borjie.ai/cb',
      codeVerifier: 'v1',
      fetcher,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.accessToken).toBe('tok-1');
    expect(out.refreshToken).toBe('ref-1');
    expect(out.expiresAt).toBe('2026-05-26T12:00:00.000Z');
  });
});

describe('X refreshAccessToken', () => {
  it('persists the rotated tokens on success', async () => {
    const saved: Array<{ accessToken: string; refreshToken: string }> = [];
    const storage: EncryptedTokenStoragePort = Object.freeze({
      load: async () => null,
      save: async (_t, creds) => {
        saved.push(creds);
      },
      markAuthFailed: async () => undefined,
    });
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-new',
        refresh_token: 'ref-new',
        expires_in: 7200,
      }),
    }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'x-client',
      clientSecret: 'x-secret',
      refreshToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.status).toBe('ok');
    expect(saved[0]?.accessToken).toBe('tok-new');
    expect(saved[0]?.refreshToken).toBe('ref-new');
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
      clientId: 'x-client',
      clientSecret: 'x-secret',
      refreshToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.now(),
    });
    expect(out.status).toBe('auth-failed');
    expect(marked).toBe(true);
  });
});
