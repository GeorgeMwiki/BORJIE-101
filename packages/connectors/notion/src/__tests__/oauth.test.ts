import { describe, it, expect } from 'vitest';
import { exchangeNotionAuthCode } from '../auth/oauth.js';
import { rotateNotionAccessToken } from '../auth/token-refresh.js';
import type { EncryptedCredentialStore, Fetcher } from '../types.js';

const passthroughStore: EncryptedCredentialStore = {
  async seal(plaintext) {
    return new TextEncoder().encode(plaintext);
  },
  async open(ciphertext) {
    return new TextDecoder().decode(ciphertext);
  },
};

const FIXED_NOW = '2026-05-26T10:00:00.000Z';

describe('Notion OAuth + rotation', () => {
  it('exchanges an auth code and seals the access token', async () => {
    const fetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({
          access_token: 'secret_xyz',
          workspace_id: 'ws_1',
          workspace_name: 'Mr. Mwikila Workspace',
          bot_id: 'bot_1',
        }),
        { status: 200 },
      );
    const creds = await exchangeNotionAuthCode(
      'tenant_a',
      {
        code: 'oauth_code_1',
        redirectUri: 'https://borjie.test/cb',
        clientId: 'cid',
        clientSecret: 'csec',
      },
      { fetcher, store: passthroughStore, nowIso: () => FIXED_NOW },
    );
    expect(creds.workspaceId).toBe('ws_1');
    expect(await passthroughStore.open(creds.encryptedAccessToken)).toBe('secret_xyz');
  });

  it('throws when the token endpoint returns non-2xx', async () => {
    const fetcher: Fetcher = async () => new Response('bad', { status: 400 });
    await expect(
      exchangeNotionAuthCode(
        'tenant_a',
        {
          code: 'oauth_code_1',
          redirectUri: 'https://borjie.test/cb',
          clientId: 'cid',
          clientSecret: 'csec',
        },
        { fetcher, store: passthroughStore, nowIso: () => FIXED_NOW },
      ),
    ).rejects.toThrow(/token exchange/);
  });

  it('rotates only the access token blob', async () => {
    const fetcher: Fetcher = async () =>
      new Response(
        JSON.stringify({
          access_token: 'first',
          workspace_id: 'ws_1',
          bot_id: 'bot_1',
        }),
        { status: 200 },
      );
    const creds = await exchangeNotionAuthCode(
      'tenant_a',
      {
        code: 'oauth_code_1',
        redirectUri: 'https://borjie.test/cb',
        clientId: 'cid',
        clientSecret: 'csec',
      },
      { fetcher, store: passthroughStore, nowIso: () => FIXED_NOW },
    );
    const rotated = await rotateNotionAccessToken(
      creds,
      { newAccessToken: 'second' },
      passthroughStore,
    );
    expect(await passthroughStore.open(rotated.encryptedAccessToken)).toBe('second');
    expect(rotated.workspaceId).toBe(creds.workspaceId);
    expect(rotated.botId).toBe(creds.botId);
  });
});
