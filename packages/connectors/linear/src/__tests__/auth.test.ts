/**
 * Linear OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, LinearInstall } from '../types.js';

function makeInstall(): LinearInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'BORJIE',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(r: { status: number; body: string }): FetcherPort {
  return {
    fetch: async () => ({ status: r.status, headers: {}, text: async () => r.body }),
  };
}

describe('linear/auth', () => {
  it('buildAuthorizeUrl uses scope=read by default', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/cb',
      state: 's',
    });
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('scope=read');
  });

  it('exchangeCode parses access token', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' }),
    });
    const tok = await exchangeCode({
      install: makeInstall(),
      code: 'code',
      redirectUri: 'https://borjie.example.com/oauth/cb',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('a');
    expect(tok.refreshToken).toBe('r');
  });

  it('refreshAccessToken throws on non-2xx', async () => {
    const fetcher = fakeFetcher({ status: 401, body: '{}' });
    await expect(
      refreshAccessToken({ install: makeInstall(), refreshToken: 'r', fetcher, nowMs: () => 0 }),
    ).rejects.toThrow(/status=401/);
  });
});
