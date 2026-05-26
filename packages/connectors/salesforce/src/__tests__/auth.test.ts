/**
 * Salesforce OAuth tests — token exchange + refresh.
 */

import { describe, it, expect } from 'vitest';

import {
  buildAuthorizeUrl,
  exchangeCode,
  type OAuth2TokenResult,
} from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, SalesforceInstall } from '../types.js';

function makeInstall(): SalesforceInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'org-borjie',
    instanceUrl: 'https://my-org.my.salesforce.com',
    clientId: 'client-id-abc',
    clientSecret: 'client-secret-xyz',
  };
}

function fakeFetcher(
  response: { status: number; body: string; headers?: Readonly<Record<string, string>> },
): FetcherPort {
  return {
    fetch: async () => ({
      status: response.status,
      headers: response.headers ?? {},
      text: async () => response.body,
    }),
  };
}

describe('salesforce/auth', () => {
  it('buildAuthorizeUrl encodes scope, state, and client_id', () => {
    const url = buildAuthorizeUrl({
      install: makeInstall(),
      redirectUri: 'https://borjie.example.com/oauth/callback',
      state: 'state-123',
    });
    expect(url).toContain('client_id=client-id-abc');
    expect(url).toContain('state=state-123');
    expect(url).toContain('scope=api+refresh_token+offline_access');
    expect(url).toContain('response_type=code');
  });

  it('exchangeCode parses token response and computes expiresAt', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({
        access_token: 'a-token',
        refresh_token: 'r-token',
        instance_url: 'https://my-org.my.salesforce.com',
        token_type: 'Bearer',
      }),
    });
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
    const result: OAuth2TokenResult = await exchangeCode({
      install: makeInstall(),
      code: 'auth-code',
      redirectUri: 'https://borjie.example.com/oauth/callback',
      fetcher,
      nowMs: () => fixedNow,
    });
    expect(result.accessToken).toBe('a-token');
    expect(result.refreshToken).toBe('r-token');
    expect(result.expiresAt).toBe(
      new Date(fixedNow + 4 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('refreshAccessToken returns refreshed access token and preserves refresh token', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: JSON.stringify({
        access_token: 'new-access',
        instance_url: 'https://my-org.my.salesforce.com',
        token_type: 'Bearer',
      }),
    });
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
    const refreshed = await refreshAccessToken({
      install: makeInstall(),
      refreshToken: 'r-token-stored',
      fetcher,
      nowMs: () => fixedNow,
    });
    expect(refreshed.accessToken).toBe('new-access');
    expect(refreshed.refreshToken).toBe('r-token-stored');
    expect(refreshed.expiresAt).toBe(
      new Date(fixedNow + 4 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('refreshAccessToken throws on non-2xx', async () => {
    const fetcher = fakeFetcher({
      status: 401,
      body: '{"error":"invalid_grant"}',
    });
    await expect(
      refreshAccessToken({
        install: makeInstall(),
        refreshToken: 'r-token',
        fetcher,
        nowMs: () => 0,
      }),
    ).rejects.toThrow(/status=401/);
  });
});
