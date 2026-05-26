import { describe, it, expect } from 'vitest';
import { exchangeDriveAuthCode } from '../auth/oauth.js';
import { refreshDriveAccessToken } from '../auth/token-refresh.js';
import type { EncryptedCredentialStore, Fetcher } from '../types.js';

const passthroughStore: EncryptedCredentialStore = {
  async seal(plaintext) {
    return new TextEncoder().encode(plaintext);
  },
  async open(ciphertext) {
    return new TextDecoder().decode(ciphertext);
  },
};

describe('Drive OAuth + refresh', () => {
  it('exchanges an auth code and seals both tokens', async () => {
    const fetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({
          access_token: 'access_1',
          refresh_token: 'refresh_1',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.readonly',
        }),
        { status: 200 },
      );
    const creds = await exchangeDriveAuthCode(
      'tenant_a',
      'george@borjie.test',
      {
        code: 'oauth_code',
        redirectUri: 'https://borjie.test/cb',
        clientId: 'cid',
        clientSecret: 'csec',
      },
      {
        fetcher,
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:00.000Z',
      },
    );
    expect(await passthroughStore.open(creds.encryptedAccessToken)).toBe('access_1');
    expect(await passthroughStore.open(creds.encryptedRefreshToken)).toBe('refresh_1');
    expect(creds.expiresAt).toBe('2026-05-26T11:00:00.000Z');
  });

  it('throws when exchange returns non-2xx', async () => {
    const fetcher: Fetcher = async () => new Response('boom', { status: 500 });
    await expect(
      exchangeDriveAuthCode(
        'tenant_a',
        'george@borjie.test',
        {
          code: 'oauth_code',
          redirectUri: 'https://borjie.test/cb',
          clientId: 'cid',
          clientSecret: 'csec',
        },
        {
          fetcher,
          store: passthroughStore,
          nowIso: () => '2026-05-26T10:00:00.000Z',
        },
      ),
    ).rejects.toThrow(/token exchange/);
  });

  it('returns fresh when access token is far from expiry', async () => {
    const fetcher: Fetcher = async () => new Response('not called', { status: 200 });
    const creds = await exchangeDriveAuthCode(
      'tenant_a',
      'a',
      { code: 'c', redirectUri: 'r', clientId: 'i', clientSecret: 's' },
      {
        fetcher: async () =>
          new Response(
            JSON.stringify({
              access_token: 'first',
              refresh_token: 'r',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200 },
          ),
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:00.000Z',
      },
    );
    const outcome = await refreshDriveAccessToken(
      creds,
      { clientId: 'i', clientSecret: 's' },
      {
        fetcher,
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:30:00.000Z',
      },
    );
    expect(outcome.kind).toBe('fresh');
  });

  it('refreshes the access token when within the 5-min safety margin', async () => {
    const seedFetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({
          access_token: 'old',
          refresh_token: 'rtok',
          expires_in: 60,
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    const creds = await exchangeDriveAuthCode(
      'tenant_a',
      'a',
      { code: 'c', redirectUri: 'r', clientId: 'i', clientSecret: 's' },
      {
        fetcher: seedFetcher,
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:00.000Z',
      },
    );
    const refreshFetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({ access_token: 'new', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200 },
      );
    const outcome = await refreshDriveAccessToken(
      creds,
      { clientId: 'i', clientSecret: 's' },
      {
        fetcher: refreshFetcher,
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:30.000Z',
      },
    );
    expect(outcome.kind).toBe('refreshed');
    if (outcome.kind === 'refreshed') {
      expect(await passthroughStore.open(outcome.credentials.encryptedAccessToken)).toBe(
        'new',
      );
    }
  });

  it('reports auth-failed on 400 from refresh endpoint', async () => {
    const seedFetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({
          access_token: 'old',
          refresh_token: 'rtok',
          expires_in: 60,
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    const creds = await exchangeDriveAuthCode(
      'tenant_a',
      'a',
      { code: 'c', redirectUri: 'r', clientId: 'i', clientSecret: 's' },
      {
        fetcher: seedFetcher,
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:00.000Z',
      },
    );
    const outcome = await refreshDriveAccessToken(
      creds,
      { clientId: 'i', clientSecret: 's' },
      {
        fetcher: async () => new Response('invalid_grant', { status: 400 }),
        store: passthroughStore,
        nowIso: () => '2026-05-26T10:00:30.000Z',
      },
    );
    expect(outcome.kind).toBe('auth-failed');
  });
});
