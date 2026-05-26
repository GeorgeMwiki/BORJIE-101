/**
 * Zoom Server-to-Server OAuth tests.
 */

import { describe, it, expect } from 'vitest';

import { fetchAccountAccessToken } from '../auth/oauth.js';
import { getOrRefreshAccessToken } from '../auth/token-refresh.js';
import type { FetcherPort, ZoomInstall } from '../types.js';

function makeInstall(over: Partial<ZoomInstall> = {}): ZoomInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: 'zoom-account-id',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    ...over,
  };
}

function fakeFetcher(r: { status: number; body: string }, capture?: (h: Readonly<Record<string, string>>, body?: string) => void): FetcherPort {
  return {
    fetch: async (_url, init) => {
      capture?.(init.headers, init.body);
      return { status: r.status, headers: {}, text: async () => r.body };
    },
  };
}

describe('zoom/auth', () => {
  it('fetchAccountAccessToken sends HTTP Basic auth + account_credentials grant', async () => {
    let captured: Readonly<Record<string, string>> | undefined;
    let body: string | undefined;
    const fetcher = fakeFetcher(
      { status: 200, body: JSON.stringify({ access_token: 'a', expires_in: 3600, token_type: 'Bearer' }) },
      (h, b) => {
        captured = h;
        body = b;
      },
    );
    const tok = await fetchAccountAccessToken({
      install: makeInstall(),
      fetcher,
      nowMs: () => 1_000_000_000_000,
    });
    expect(tok.accessToken).toBe('a');
    expect(tok.expiresAt).toBe(new Date(1_000_000_000_000 + 3600 * 1000).toISOString());
    expect(captured?.authorization).toMatch(/^Basic /);
    expect(body).toContain('grant_type=account_credentials');
    expect(body).toContain('account_id=zoom-account-id');
  });

  it('fetchAccountAccessToken throws on non-2xx', async () => {
    const fetcher = fakeFetcher({ status: 401, body: '' });
    await expect(
      fetchAccountAccessToken({ install: makeInstall(), fetcher, nowMs: () => 0 }),
    ).rejects.toThrow(/Zoom S2S token fetch failed/);
  });

  it('getOrRefreshAccessToken returns unconfigured when secret missing', async () => {
    const fetcher = fakeFetcher({ status: 200, body: '{}' });
    const out = await getOrRefreshAccessToken({
      install: makeInstall({ clientSecret: '' }),
      fetcher,
      nowMs: () => 0,
    });
    expect(out.kind).toBe('unconfigured');
  });

  it('getOrRefreshAccessToken reuses cached token when not expired', async () => {
    const fetcher = fakeFetcher({ status: 500, body: 'should-not-be-called' });
    const cache = {
      load: async () => ({ accessToken: 'cached', expiresAt: new Date(Date.now() + 600_000).toISOString() }),
      save: async () => undefined,
    };
    const out = await getOrRefreshAccessToken(
      { install: makeInstall(), fetcher, nowMs: () => Date.now() },
      cache,
    );
    expect(out.kind).toBe('cached');
    if (out.kind === 'cached') expect(out.accessToken).toBe('cached');
  });
});
