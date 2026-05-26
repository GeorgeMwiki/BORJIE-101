/**
 * HubSpot OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { buildAuthorizeUrl, exchangeCode } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, HubSpotInstall } from '../types.js';

function makeInstall(): HubSpotInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: '12345',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
}

function fakeFetcher(response: { status: number; body: string }): FetcherPort {
  return {
    fetch: async () => ({ status: response.status, headers: {}, text: async () => response.body }),
  };
}

describe('hubspot/auth', () => {
  it('buildAuthorizeUrl includes client_id, scope, state', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/callback',
      state: 'state-x',
    });
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('state=state-x');
    expect(url).toContain('scope=crm.objects.contacts.read');
  });

  it('exchangeCode parses tokens and expiresAt', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 1800,
        token_type: 'bearer',
      }),
    });
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
    const tok = await exchangeCode({
      install: makeInstall(),
      code: 'auth-code',
      redirectUri: 'https://borjie.example.com/oauth/callback',
      fetcher,
      nowMs: () => fixedNow,
    });
    expect(tok.accessToken).toBe('access');
    expect(tok.refreshToken).toBe('refresh');
    expect(tok.expiresAt).toBe(new Date(fixedNow + 1800 * 1000).toISOString());
  });

  it('refreshAccessToken rotates access + preserves refresh when not reissued', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({ access_token: 'new-access', expires_in: 3600, token_type: 'bearer' }),
    });
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
    const tok = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'stored-refresh',
      fetcher,
      nowMs: () => fixedNow,
    });
    expect(tok.accessToken).toBe('new-access');
    expect(tok.refreshToken).toBe('stored-refresh');
  });
});
