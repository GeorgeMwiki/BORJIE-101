/**
 * Jira (Atlassian) OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, JiraInstall } from '../types.js';

function makeInstall(): JiraInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'site-cloud-id-abc',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(r: { status: number; body: string }): FetcherPort {
  return { fetch: async () => ({ status: r.status, headers: {}, text: async () => r.body }) };
}

describe('jira/auth', () => {
  it('buildAuthorizeUrl sets audience + scope + prompt=consent', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/cb',
      state: 's',
    });
    expect(url).toContain('audience=api.atlassian.com');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('scope=read');
  });

  it('exchangeCode parses tokens and expiresAt', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 1800 }),
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

  it('refreshAccessToken rotates access + preserves refresh on no-rotate', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'new', expires_in: 3600 }),
    });
    const tok = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'stored-refresh',
      fetcher,
      nowMs: () => 0,
    });
    expect(tok.accessToken).toBe('new');
    expect(tok.refreshToken).toBe('stored-refresh');
  });
});
