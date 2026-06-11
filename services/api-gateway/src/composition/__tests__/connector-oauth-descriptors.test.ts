/**
 * connector-oauth-descriptors tests — the generative OAuth engine.
 *
 * Locks the security rails of the connect flow's declarative half:
 *   - signed state: roundtrip, tamper, expiry, missing secret
 *   - replay guard: single-use consumption, TTL prune, bounded memory
 *   - provider config: honest { ok:false, reason } without env; strict
 *     env-derived redirect_uri (never request-derived)
 *   - authorize URL: correct Slack shape, NO client_secret anywhere
 *   - code exchange: mocked fetch → normalized tokens; every failure path
 *     returns a token-free, secret-free reason
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildConnectorAuthorizeUrl,
  CONNECTOR_OAUTH_CALLBACK_PATH,
  CONNECTOR_OAUTH_DESCRIPTORS,
  CONNECTOR_OAUTH_STATE_TTL_MS,
  createOAuthStateReplayGuard,
  decodeConnectorOAuthState,
  encodeConnectorOAuthState,
  exchangeConnectorAuthorizationCode,
  getConnectorOAuthDescriptor,
  isStateSigningProvisioned,
  readConnectorOAuthProviderConfig,
} from '../connector-oauth-descriptors.js';

const ENV: NodeJS.ProcessEnv = {
  SLACK_CLIENT_ID: 'client-id-1',
  SLACK_CLIENT_SECRET: 'client-secret-XYZZY',
  CONNECTOR_OAUTH_REDIRECT_BASE: 'https://api.test.borjie.app/',
  CONNECTOR_OAUTH_STATE_SECRET: 'unit-test-state-secret',
};

const CLAIMS = {
  tenantId: 't-1',
  userId: 'u-1',
  connectorId: 'slack',
} as const;

const slack = CONNECTOR_OAUTH_DESCRIPTORS.slack!;

describe('signed single-use state', () => {
  it('roundtrips claims through encode → decode', () => {
    const state = encodeConnectorOAuthState(CLAIMS, ENV);
    const decoded = decodeConnectorOAuthState(state, ENV);
    expect(decoded).toMatchObject(CLAIMS);
    expect(decoded?.nonce).toBeTruthy();
    expect(decoded?.exp).toBeGreaterThan(Date.now());
  });

  it('rejects a tampered payload (MAC mismatch)', () => {
    const state = encodeConnectorOAuthState(CLAIMS, ENV);
    const [payload, mac] = state.split('.') as [string, string];
    const evil = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        tenantId: 't-ATTACKER',
      }),
      'utf8',
    ).toString('base64url');
    expect(decodeConnectorOAuthState(`${evil}.${mac}`, ENV)).toBeNull();
  });

  it('rejects a tampered MAC and malformed strings', () => {
    const state = encodeConnectorOAuthState(CLAIMS, ENV);
    expect(decodeConnectorOAuthState(`${state}x`, ENV)).toBeNull();
    expect(decodeConnectorOAuthState('not-a-state', ENV)).toBeNull();
    expect(decodeConnectorOAuthState('', ENV)).toBeNull();
  });

  it('rejects an expired state', () => {
    const past = Date.now() - CONNECTOR_OAUTH_STATE_TTL_MS - 1000;
    const state = encodeConnectorOAuthState(CLAIMS, ENV, past);
    expect(decodeConnectorOAuthState(state, ENV)).toBeNull();
  });

  it('rejects a state signed with a different secret', () => {
    const state = encodeConnectorOAuthState(CLAIMS, ENV);
    const otherEnv = { ...ENV, CONNECTOR_OAUTH_STATE_SECRET: 'other-secret' };
    expect(decodeConnectorOAuthState(state, otherEnv)).toBeNull();
  });

  it('refuses to encode and decode without any signing secret', () => {
    const bare: NodeJS.ProcessEnv = {};
    expect(isStateSigningProvisioned(bare)).toBe(false);
    expect(() => encodeConnectorOAuthState(CLAIMS, bare)).toThrow(/state signing/);
    const state = encodeConnectorOAuthState(CLAIMS, ENV);
    expect(decodeConnectorOAuthState(state, bare)).toBeNull();
  });

  it('falls back to the cipher key material when no explicit state secret', () => {
    const env: NodeJS.ProcessEnv = { CONNECTOR_TOKEN_KEY: 'cipher-key' };
    expect(isStateSigningProvisioned(env)).toBe(true);
    const state = encodeConnectorOAuthState(CLAIMS, env);
    expect(decodeConnectorOAuthState(state, env)).toMatchObject(CLAIMS);
  });
});

describe('replay guard (single-use, bounded, TTL)', () => {
  it('consumes a nonce exactly once', () => {
    const guard = createOAuthStateReplayGuard();
    const exp = Date.now() + 60_000;
    expect(guard.consume('nonce-a', exp)).toBe(true);
    expect(guard.consume('nonce-a', exp)).toBe(false);
    expect(guard.consume('nonce-b', exp)).toBe(true);
  });

  it('prunes expired nonces (signature TTL independently rejects them)', () => {
    let t = 1_000_000;
    const guard = createOAuthStateReplayGuard({ now: () => t });
    expect(guard.consume('n1', t + 100)).toBe(true);
    t += 200; // n1 now expired → pruned
    expect(guard.consume('n1', t + 100)).toBe(true);
  });

  it('bounds memory by evicting oldest entries', () => {
    const guard = createOAuthStateReplayGuard({ maxEntries: 3 });
    const exp = Date.now() + 60_000;
    expect(guard.consume('a', exp)).toBe(true);
    expect(guard.consume('b', exp)).toBe(true);
    expect(guard.consume('c', exp)).toBe(true);
    expect(guard.consume('d', exp)).toBe(true); // evicts 'a'
    expect(guard.consume('a', exp)).toBe(true); // 'a' evicted → re-consumable
    expect(guard.consume('d', exp)).toBe(false); // 'd' still held
  });
});

describe('provider config (env only, honest degrade)', () => {
  it('returns ok:false naming the env vars when the OAuth app is unset', () => {
    const result = readConnectorOAuthProviderConfig(slack, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('SLACK_CLIENT_ID');
      expect(result.reason).toContain('SLACK_CLIENT_SECRET');
    }
  });

  it('returns ok:false when the redirect base is unset', () => {
    const result = readConnectorOAuthProviderConfig(slack, {
      SLACK_CLIENT_ID: 'x',
      SLACK_CLIENT_SECRET: 'y',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('CONNECTOR_OAUTH_REDIRECT_BASE');
    }
  });

  it('derives the redirect_uri from env (trailing slash trimmed)', () => {
    const result = readConnectorOAuthProviderConfig(slack, ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.redirectUri).toBe(
        `https://api.test.borjie.app${CONNECTOR_OAUTH_CALLBACK_PATH}`,
      );
      expect(result.config.clientId).toBe('client-id-1');
    }
  });
});

describe('authorize URL', () => {
  it('builds the Slack consent URL with id/scope/redirect/state — never the secret', () => {
    const config = readConnectorOAuthProviderConfig(slack, ENV);
    if (!config.ok) throw new Error('config must be ok');
    const url = buildConnectorAuthorizeUrl({
      descriptor: slack,
      config: config.config,
      state: 'the-state',
    });
    expect(url.startsWith('https://slack.com/oauth/v2/authorize?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('client-id-1');
    expect(parsed.searchParams.get('scope')).toBe(
      'chat:write,channels:history,channels:read',
    );
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      `https://api.test.borjie.app${CONNECTOR_OAUTH_CALLBACK_PATH}`,
    );
    expect(parsed.searchParams.get('state')).toBe('the-state');
    expect(url).not.toContain('client-secret-XYZZY');
    expect(url).not.toContain('client_secret');
  });
});

describe('authorization-code exchange (mocked fetch)', () => {
  const okSlackPayload = {
    ok: true,
    access_token: 'xoxb-test-token',
    token_type: 'Bearer',
    scope: 'chat:write,channels:history',
    bot_user_id: 'B1',
    team: { id: 'T-123', name: 'Acme' },
    enterprise: null,
    authed_user: { id: 'U1' },
  };

  const config = (() => {
    const r = readConnectorOAuthProviderConfig(slack, ENV);
    if (!r.ok) throw new Error('config must be ok');
    return r.config;
  })();

  it('exchanges a code → normalized tokens (account, scopes, no expiry)', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe('https://slack.com/api/oauth.v2.access');
      const body = (init as { body: string }).body;
      expect(body).toContain('code=the-code');
      expect(body).toContain('client_id=client-id-1');
      expect(body).toContain('client_secret=client-secret-XYZZY');
      return new Response(JSON.stringify(okSlackPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'the-code',
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('xoxb-test-token');
      expect(result.tokens.refreshToken).toBeNull();
      expect(result.tokens.account).toBe('T-123');
      expect(result.tokens.scopes).toEqual(['chat:write', 'channels:history']);
      expect(result.tokens.expiresAt).toBeNull();
    }
  });

  it('maps rotation responses (refresh_token + expires_in)', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          ...okSlackPayload,
          refresh_token: 'xoxe-refresh',
          expires_in: 3600,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const result = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'c',
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.refreshToken).toBe('xoxe-refresh');
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
      expect(result.tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('returns a token-free reason when the provider refuses the code', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'bad',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('invalid_code');
      expect(JSON.stringify(result)).not.toContain('client-secret-XYZZY');
      expect(JSON.stringify(result)).not.toContain('xoxb');
    }
  });

  it('returns a reason on HTTP / transport / non-JSON failures', async () => {
    const http500 = (async () =>
      new Response('oops', { status: 500 })) as unknown as typeof fetch;
    const r1 = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'c',
      fetchImpl: http500,
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toContain('HTTP 500');

    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r2 = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'c',
      fetchImpl: boom,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('transport');

    const notJson = (async () =>
      new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    const r3 = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'c',
      fetchImpl: notJson,
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toContain('non-JSON');
  });

  it('returns a shape-only reason (no values) on payload mismatch', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true, access_token: '' }), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await exchangeConnectorAuthorizationCode({
      descriptor: slack,
      config,
      code: 'c',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('shape mismatch');
  });
});

describe('descriptor registry (generative seam)', () => {
  it('resolves slack and rejects unknown ids', () => {
    expect(getConnectorOAuthDescriptor('slack')?.connectorId).toBe('slack');
    expect(getConnectorOAuthDescriptor('not-a-thing')).toBeNull();
  });

  it('keeps the credentialKind aligned with the catalog credentialKinds', async () => {
    const { getConnectorDescriptor } = await import('../connector-catalog.js');
    for (const descriptor of Object.values(CONNECTOR_OAUTH_DESCRIPTORS)) {
      const catalogEntry = getConnectorDescriptor(descriptor.connectorId);
      expect(catalogEntry).not.toBeNull();
      expect(catalogEntry!.credentialKinds).toContain(descriptor.credentialKind);
    }
  });
});
