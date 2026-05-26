import { describe, expect, it } from 'vitest';
import {
  TOKEN_REFRESH_MARGIN_MS,
  createTokenRefresher,
} from '../auth/token-refresh.js';
import {
  GOOGLE_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/email-fixtures.js';

describe('Email token refresh', () => {
  it('returns not-yet-due when expiry is beyond the safety margin', async () => {
    const refresh = createTokenRefresher({
      fetcher: async () => {
        throw new Error('should not call');
      },
    });
    const now = new Date('2026-05-26T00:00:00.000Z');
    const farFuture = new Date(
      now.getTime() + TOKEN_REFRESH_MARGIN_MS + 60_000,
    ).toISOString();
    const result = await refresh({
      provider: 'gmail',
      refreshToken: '1//rt',
      expiresAt: farFuture,
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: now.toISOString(),
    });
    expect(result.kind).toBe('not-yet-due');
  });

  it('refreshes Gmail tokens and preserves rotated refresh token', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({
        ...GOOGLE_OAUTH_OK_PAYLOAD,
        access_token: 'ya29-rotated',
        refresh_token: '1//rt-rotated',
      }),
    ]);
    const refresh = createTokenRefresher({ fetcher });
    const result = await refresh({
      provider: 'gmail',
      refreshToken: '1//rt-old',
      expiresAt: '2020-01-01T00:00:00.000Z',
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: '2026-05-26T00:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.accessToken).toBe('ya29-rotated');
      expect(result.refreshToken).toBe('1//rt-rotated');
    }
  });

  it('keeps old refresh token when provider does not rotate', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({
        access_token: 'new-access',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    ]);
    const refresh = createTokenRefresher({ fetcher });
    const result = await refresh({
      provider: 'outlook_mail',
      refreshToken: 'ms-keep',
      expiresAt: '2020-01-01T00:00:00.000Z',
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: '2026-05-26T00:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.refreshToken).toBe('ms-keep');
    }
  });
});
