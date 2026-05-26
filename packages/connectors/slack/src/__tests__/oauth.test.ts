import { describe, expect, it } from 'vitest';
import { createSlackOAuthExchange } from '../auth/oauth.js';
import {
  SLACK_OAUTH_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/slack-fixtures.js';

describe('Slack OAuth — code → tokens exchange', () => {
  it('returns parsed tokens on a successful exchange', async () => {
    const { fetcher, calls } = createCannedFetcher([
      buildFetcherResponse(SLACK_OAUTH_OK_PAYLOAD),
    ]);
    const exchange = createSlackOAuthExchange({ fetcher });

    const result = await exchange({
      code: 'AC-test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://borjie.example/oauth/callback',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.tokens.access_token).toBe('xoxb-test-bot-token');
    expect(result.tokens.team.id).toBe('T01TEAM');
    expect(result.tokens.refresh_token).toBe('xoxe-1-test-refresh');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://slack.com/api/oauth.v2.access');
    expect(calls[0]?.method).toBe('POST');
  });

  it('returns invalid-code when Slack responds ok:false', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({ ok: false, error: 'invalid_code' }),
    ]);
    const exchange = createSlackOAuthExchange({ fetcher });

    const result = await exchange({
      code: 'AC-bad',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/callback',
    });

    expect(result.kind).toBe('invalid-code');
    if (result.kind === 'invalid-code') {
      expect(result.message).toBe('invalid_code');
    }
  });

  it('returns transport-error when the fetcher throws', async () => {
    const exchange = createSlackOAuthExchange({
      fetcher: async () => {
        throw new Error('econnreset');
      },
    });
    const result = await exchange({
      code: 'AC',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://borjie.example/callback',
    });
    expect(result.kind).toBe('transport-error');
    if (result.kind === 'transport-error') {
      expect(result.message).toBe('econnreset');
    }
  });
});
