/**
 * Auth providers — bearer, service token, OAuth-PKCE flow.
 */

import { describe, it, expect } from 'vitest';
import {
  createBearerAuth,
  createOAuthPKCEFlow,
  createServiceTokenAuth,
} from '../auth/pkce.js';

describe('bearer auth', () => {
  it('returns the stored token verbatim', async () => {
    const a = createBearerAuth({ token: 'xyz' });
    expect(await a.getAuthorizationHeader()).toBe('Bearer xyz');
  });
});

describe('service token auth', () => {
  it('returns the stored token + rotates near expiry', async () => {
    let current = { token: 't1', expiresAt: Date.now() - 1_000 };
    let rotated = 0;
    const a = createServiceTokenAuth({
      tokenStore: {
        async getToken() {
          return current;
        },
        async rotate() {
          rotated++;
          current = { token: `t-rot-${rotated}`, expiresAt: Date.now() + 60_000 };
          return current;
        },
      },
    });
    const header = await a.getAuthorizationHeader();
    expect(header).toBe('Bearer t-rot-1');
    expect(rotated).toBe(1);
  });
});

describe('OAuth 2.1 + PKCE', () => {
  it('startChallenge yields verifier + challenge + state', () => {
    const flow = createOAuthPKCEFlow({
      clientId: 'mcp-client',
      authzServer: {
        authorizationEndpoint: 'https://idp.example/authorize',
        tokenEndpoint: 'https://idp.example/token',
      },
      redirectUri: 'https://app.example/cb',
      scopes: ['mcp'],
    });
    const ch = flow.startChallenge();
    expect(ch.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(ch.codeChallenge.length).toBeGreaterThan(0);
    expect(ch.codeChallengeMethod).toBe('S256');
    expect(ch.state.length).toBeGreaterThan(8);
  });

  it('buildAuthorizeUrl carries all required params', () => {
    const flow = createOAuthPKCEFlow({
      clientId: 'mcp-client',
      authzServer: {
        authorizationEndpoint: 'https://idp.example/authorize',
        tokenEndpoint: 'https://idp.example/token',
      },
      redirectUri: 'https://app.example/cb',
      scopes: ['mcp', 'tenant:read'],
    });
    const ch = flow.startChallenge();
    const url = new URL(flow.buildAuthorizeUrl(ch));
    expect(url.searchParams.get('client_id')).toBe('mcp-client');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(ch.codeChallenge);
    expect(url.searchParams.get('state')).toBe(ch.state);
    expect(url.searchParams.get('scope')).toBe('mcp tenant:read');
  });

  it('exchangeCode rejects on state mismatch', async () => {
    const flow = createOAuthPKCEFlow({
      clientId: 'c',
      authzServer: {
        authorizationEndpoint: 'https://x/a',
        tokenEndpoint: 'https://x/t',
      },
      redirectUri: 'https://x/cb',
      scopes: ['mcp'],
      fetchImpl: (async () =>
        new Response('{}', { status: 200 })) as unknown as typeof fetch,
    });
    const ch = flow.startChallenge();
    await expect(
      flow.exchangeCode({ code: 'abc', state: 'WRONG', challenge: ch }),
    ).rejects.toThrow(/state mismatch/);
  });

  it('exchangeCode posts the verifier + returns a working AuthProvider', async () => {
    const captured: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured.push({ url, body: String(init.body) });
      return new Response(
        JSON.stringify({
          access_token: 'AT-1',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'RT-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const flow = createOAuthPKCEFlow({
      clientId: 'c',
      authzServer: {
        authorizationEndpoint: 'https://x/a',
        tokenEndpoint: 'https://x/t',
      },
      redirectUri: 'https://x/cb',
      scopes: ['mcp'],
      fetchImpl,
    });
    const ch = flow.startChallenge();
    const auth = await flow.exchangeCode({ code: 'C', state: ch.state, challenge: ch });
    expect(captured[0]?.body).toContain(`code_verifier=${ch.codeVerifier}`);
    expect(captured[0]?.body).toContain('client_id=c');
    expect(auth.accessToken).toBe('AT-1');
    expect(await auth.getAuthorizationHeader()).toBe('Bearer AT-1');
  });
});
