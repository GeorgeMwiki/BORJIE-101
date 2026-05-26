import { describe, expect, it } from 'vitest';
import { createCalendarOAuthExchange } from '../auth/oauth.js';
import {
  GOOGLE_OAUTH_OK_PAYLOAD,
  MICROSOFT_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/calendar-fixtures.js';

describe('Calendar OAuth — code → tokens', () => {
  it('exchanges Google calendar authorisation code for tokens', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse(GOOGLE_OAUTH_OK_PAYLOAD),
    ]);
    const exchange = createCalendarOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'google_calendar',
      code: 'AC',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.tokens.access_token).toBe('ya29-test');
    }
  });

  it('exchanges Outlook calendar authorisation code for tokens', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse(MICROSOFT_OAUTH_OK_PAYLOAD),
    ]);
    const exchange = createCalendarOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'outlook_calendar',
      code: 'AC',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.tokens.access_token).toBe('ms-test');
    }
  });

  it('returns invalid-code on 400 invalid_grant', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({ error: 'invalid_grant' }, { status: 400 }),
    ]);
    const exchange = createCalendarOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'google_calendar',
      code: 'AC',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('invalid-code');
  });
});
