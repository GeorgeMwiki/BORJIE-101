/**
 * Microsoft Teams OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, TeamsInstall } from '../types.js';

function makeInstall(): TeamsInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: '11111111-1111-1111-1111-111111111111',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(r: { status: number; body: string }): FetcherPort {
  return { fetch: async () => ({ status: r.status, headers: {}, text: async () => r.body }) };
}

describe('teams/auth', () => {
  it('buildAuthorizeUrl targets the tenant-scoped MS endpoint', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/cb',
      state: 's',
    });
    expect(url).toContain('login.microsoftonline.com/11111111');
    expect(url).toContain('scope=ChannelMessage.Read.All');
  });

  it('exchangeCode handles client_credentials grant', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'a', expires_in: 3600, token_type: 'Bearer' }),
    });
    const tok = await exchangeCode({
      install: makeInstall(),
      code: '__client_credentials__',
      redirectUri: 'https://borjie.example.com/oauth/cb',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('a');
    expect(tok.refreshToken).toBe(''); // client_credentials has no refresh
  });

  it('refreshAccessToken rotates access token', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }),
    });
    const tok = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'r1',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('new');
    expect(tok.refreshToken).toBe('r2');
  });
});
