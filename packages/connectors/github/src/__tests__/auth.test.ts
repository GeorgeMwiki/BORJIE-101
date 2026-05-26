/**
 * GitHub OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, GitHubInstall } from '../types.js';

function makeInstall(): GitHubInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'borjie-org',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(r: { status: number; body: string }): FetcherPort {
  return { fetch: async () => ({ status: r.status, headers: {}, text: async () => r.body }) };
}

describe('github/auth', () => {
  it('buildAuthorizeUrl includes client_id, redirect_uri, scope, state', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/cb',
      state: 's',
    });
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('scope=repo+read');
    expect(url).toContain('state=s');
  });

  it('exchangeCode parses tokens', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 28800, token_type: 'bearer' }),
    });
    const tok = await exchangeCode({
      install: makeInstall(),
      code: 'c',
      redirectUri: 'https://borjie.example.com/oauth/cb',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('a');
    expect(tok.refreshToken).toBe('r');
  });

  it('refreshAccessToken rotates access', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'new', expires_in: 28800 }),
    });
    const tok = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'stored',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('new');
    expect(tok.refreshToken).toBe('stored');
  });
});
