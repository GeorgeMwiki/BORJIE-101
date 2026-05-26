/**
 * GitLab OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, GitLabInstall } from '../types.js';

function makeInstall(): GitLabInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'borjie-group',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(r: { status: number; body: string }): FetcherPort {
  return { fetch: async () => ({ status: r.status, headers: {}, text: async () => r.body }) };
}

describe('gitlab/auth', () => {
  it('buildAuthorizeUrl honours self-hosted base URL', () => {
    const url = buildAuthorizeUrl({
      install: { ...makeInstall(), baseUrl: 'https://gitlab.borjie.tz' },
      redirectUri: 'https://borjie.example.com/oauth/cb',
      state: 's',
    });
    expect(url).toContain('gitlab.borjie.tz/oauth/authorize');
    expect(url).toContain('scope=read_api+read_repository+read_user');
  });

  it('exchangeCode parses tokens', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 7200 }),
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

  it('refreshAccessToken rotates access token', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'new', expires_in: 7200 }),
    });
    const tok = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'stored',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('new');
  });
});
