import { describe, expect, it } from 'vitest';
import {
  TOKEN_REFRESH_MARGIN_MS,
  createTokenRefresher,
} from '../auth/token-refresh.js';
import {
  GOOGLE_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/calendar-fixtures.js';

describe('Calendar token refresh', () => {
  it('returns not-yet-due when expiry is beyond margin', async () => {
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
      provider: 'google_calendar',
      refreshToken: '1//rt',
      expiresAt: farFuture,
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: now.toISOString(),
    });
    expect(result.kind).toBe('not-yet-due');
  });

  it('refreshes Google calendar tokens', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({
        ...GOOGLE_OAUTH_OK_PAYLOAD,
        access_token: 'ya29-rotated',
      }),
    ]);
    const refresh = createTokenRefresher({ fetcher });
    const result = await refresh({
      provider: 'google_calendar',
      refreshToken: '1//rt',
      expiresAt: '2020-01-01T00:00:00.000Z',
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: '2026-05-26T00:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.accessToken).toBe('ya29-rotated');
    }
  });
});
