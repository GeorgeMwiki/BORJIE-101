import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import {
  refreshAccessToken,
  type EncryptedTokenStoragePort,
} from '../auth/token-refresh.js';
import type { FetcherPort, TikTokInstall } from '../types.js';

const install: TikTokInstall = Object.freeze({
  tenantId: 'tenant-a',
  account: 'tk-bus-1',
  clientKey: 'tt-client',
  clientSecret: 'tt-secret',
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

describe('TikTok buildAuthorizeUrl', () => {
  it('includes client_key, redirect_uri, state and the default scope', () => {
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/oauth/tiktok',
        state: 's-1',
      }),
    );
    expect(u.searchParams.get('client_key')).toBe('tt-client');
    expect(u.searchParams.get('state')).toBe('s-1');
    expect(u.searchParams.get('scope')).toContain('video.list');
  });
});

describe('TikTok exchangeCode', () => {
  it('parses access_token + refresh_token + expires_in from the response', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        refresh_token: 'ref-1',
        expires_in: 86400,
        refresh_expires_in: 31536000,
        open_id: 'open-abc',
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
    expect(out.refreshToken).toBe('ref-1');
    expect(out.openId).toBe('open-abc');
    // 86400s = 24h.
    expect(out.expiresAt).toBe('2026-05-27T10:00:00.000Z');
  });

  it('throws on a non-200 response', async () => {
    const fetcher = makeFetcher(() => ({ status: 500, body: '' }));
    await expect(
      exchangeCode({
        install,
        code: 'c1',
        redirectUri: 'https://app.borjie.ai/cb',
        fetcher,
        nowMs: () => 0,
      }),
    ).rejects.toThrow();
  });
});

describe('TikTok refreshAccessToken', () => {
  it('persists the rotated token + refresh-token on success', async () => {
    const saved: Array<{ accessToken: string; refreshToken: string }> = [];
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
        refresh_token: 'ref-new',
        expires_in: 86400,
      }),
    }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientKey: 'k',
      clientSecret: 's',
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
      clientKey: 'k',
      clientSecret: 's',
      refreshToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.now(),
    });
    expect(out.status).toBe('auth-failed');
    expect(marked).toBe(true);
  });
});
