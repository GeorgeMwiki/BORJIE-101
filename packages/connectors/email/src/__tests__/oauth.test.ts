import { describe, expect, it } from 'vitest';
import { createEmailOAuthExchange } from '../auth/oauth.js';
import {
  GOOGLE_OAUTH_OK_PAYLOAD,
  MICROSOFT_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/email-fixtures.js';

describe('Email OAuth — code → tokens', () => {
  it('exchanges Gmail authorisation code for tokens', async () => {
    const { fetcher, calls } = createCannedFetcher([
      buildFetcherResponse(GOOGLE_OAUTH_OK_PAYLOAD),
    ]);
    const exchange = createEmailOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'gmail',
      code: 'AC-G',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.tokens.access_token).toBe('ya29-test-access');
      expect(result.tokens.refresh_token).toBe('1//test-refresh');
    }
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
  });

  it('exchanges Outlook authorisation code for tokens', async () => {
    const { fetcher, calls } = createCannedFetcher([
      buildFetcherResponse(MICROSOFT_OAUTH_OK_PAYLOAD),
    ]);
    const exchange = createEmailOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'outlook_mail',
      code: 'AC-M',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.tokens.access_token).toBe('ms-test-access');
    }
    expect(calls[0]?.url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    );
  });

  it('returns invalid-code on 400 invalid_grant', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({ error: 'invalid_grant' }, { status: 400 }),
    ]);
    const exchange = createEmailOAuthExchange({ fetcher });
    const result = await exchange({
      provider: 'gmail',
      code: 'AC',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/cb',
    });
    expect(result.kind).toBe('invalid-code');
  });
});
