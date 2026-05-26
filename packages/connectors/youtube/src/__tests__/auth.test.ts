import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import {
  refreshAccessToken,
  type EncryptedTokenStoragePort,
} from '../auth/token-refresh.js';
import type { FetcherPort, YouTubeInstall } from '../types.js';

const install: YouTubeInstall = Object.freeze({
  tenantId: 'tenant-a',
  channelId: 'UCfoofoofoofoofoofoofoo',
  clientId: 'g-client',
  clientSecret: 'g-secret',
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

describe('YouTube buildAuthorizeUrl', () => {
  it('forces access_type=offline + prompt=consent so we receive refresh_token', () => {
    const u = new URL(
      buildAuthorizeUrl({
        install,
        redirectUri: 'https://app.borjie.ai/oauth/youtube',
        state: 's-1',
      }),
    );
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('scope')).toContain('youtube.readonly');
  });
});

describe('YouTube exchangeCode', () => {
  it('parses access + refresh + 1h expiry', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        refresh_token: 'ref-1',
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
    expect(out.refreshToken).toBe('ref-1');
    expect(out.expiresAt).toBe('2026-05-26T11:00:00.000Z');
  });

  it('throws if refresh_token is absent (no offline consent)', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'tok-1',
        expires_in: 3600,
      }),
    }));
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

describe('YouTube refreshAccessToken', () => {
  it('persists the rotated access token + keeps the original refresh token', async () => {
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
        expires_in: 3600,
      }),
    }));
    const out = await refreshAccessToken({
      tenantId: 'tenant-a',
      clientId: 'g-client',
      clientSecret: 'g-secret',
      refreshToken: 'ref-1',
      fetcher,
      storage,
      nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
    });
    expect(out.status).toBe('ok');
    expect(saved[0]?.accessToken).toBe('tok-new');
    // Google rarely rotates the refresh_token — connector keeps the
    // pre-existing one verbatim.
    expect(saved[0]?.refreshToken).toBe('ref-1');
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
      clientId: 'g-client',
      clientSecret: 'g-secret',
      refreshToken: 'old',
      fetcher,
      storage,
      nowMs: () => Date.now(),
    });
    expect(out.status).toBe('auth-failed');
    expect(marked).toBe(true);
  });
});
