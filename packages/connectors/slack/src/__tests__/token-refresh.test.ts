import { describe, expect, it } from 'vitest';
import {
  TOKEN_REFRESH_MARGIN_MS,
  createTokenRefresher,
} from '../auth/token-refresh.js';
import {
  SLACK_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/slack-fixtures.js';

describe('Slack token refresh', () => {
  it('returns not-rotated when there is no refresh token', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse(SLACK_OAUTH_OK_PAYLOAD),
    ]);
    const refresh = createTokenRefresher({ fetcher });
    const result = await refresh({
      refreshToken: null,
      expiresAt: null,
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: '2026-05-26T00:00:00.000Z',
    });
    expect(result.kind).toBe('not-rotated');
  });

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
      refreshToken: 'rt',
      expiresAt: farFuture,
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: now.toISOString(),
    });
    expect(result.kind).toBe('not-yet-due');
  });

  it('refreshes when expiry is within the safety margin', async () => {
    const { fetcher, calls } = createCannedFetcher([
      buildFetcherResponse({
        ...SLACK_OAUTH_OK_PAYLOAD,
        access_token: 'xoxb-rotated',
        refresh_token: 'xoxe-rotated',
      }),
    ]);
    const refresh = createTokenRefresher({ fetcher });
    const now = new Date('2026-05-26T00:00:00.000Z');
    const soon = new Date(
      now.getTime() + TOKEN_REFRESH_MARGIN_MS - 1_000,
    ).toISOString();

    const result = await refresh({
      refreshToken: 'xoxe-original',
      expiresAt: soon,
      clientId: 'cid',
      clientSecret: 'cs',
      nowIso: now.toISOString(),
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.tokens.access_token).toBe('xoxb-rotated');
      expect(result.tokens.refresh_token).toBe('xoxe-rotated');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toContain('grant_type=refresh_token');
  });
});
