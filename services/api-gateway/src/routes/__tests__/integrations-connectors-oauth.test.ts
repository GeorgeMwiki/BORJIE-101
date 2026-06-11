/**
 * /api/v1/integrations/connectors — OAuth CONNECT sub-flow route tests.
 *
 * Locks the last mile of the integration fabric: the governed routes that
 * mint the provider authorize URL and SEAL the exchanged token into
 * `connector_credentials`:
 *   - start: honest { provisioned:false, reason } without provider env;
 *     a correct authorize URL with env; 401 without tenant; 404 unknown id
 *   - callback: verifies + consumes the signed state (single-use), mocked
 *     code exchange, SEALS the token (ciphertext ≠ plaintext) and upserts
 *     ONLY the state's tenant row; replay/tamper/denied → structured 400s
 *   - disconnect: best-effort provider revoke + row delete
 *   - the client_secret and plaintext token NEVER appear in any response
 *   - mount: the callback is reachable through createConnectorsRouter
 *     WITHOUT a JWT (it authenticates via the signed state alone)
 *
 * Unit test against the routers only — auth + database middlewares are
 * stubbed (no live Postgres), mirroring integrations-connectors.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const state = vi.hoisted(() => ({
  tenantId: 't-1' as string | null,
  // Rows SELECTs return; every executed statement's params are captured.
  selectRows: [] as Array<Record<string, unknown>>,
  deleteRows: [] as Array<Record<string, unknown>>,
  executed: [] as Array<{ text: string; params: unknown[] }>,
  failWrites: false,
}));

vi.mock('../../middleware/hono-auth.js', () => ({
  authMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    if (state.tenantId) {
      c.set('auth', { tenantId: state.tenantId, userId: 'u-1' });
    }
    await next();
  },
}));

vi.mock('../../middleware/database.js', () => {
  const record = (query: unknown): { text: string; params: unknown[] } => {
    const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
    const flat: unknown[] = [];
    const text: string[] = [];
    const walk = (xs: unknown[]): void => {
      for (const x of xs) {
        if (
          x &&
          typeof x === 'object' &&
          Array.isArray((x as { queryChunks?: unknown[] }).queryChunks)
        ) {
          walk((x as { queryChunks: unknown[] }).queryChunks);
        } else if (
          x &&
          typeof x === 'object' &&
          'value' in (x as Record<string, unknown>) &&
          Array.isArray((x as { value?: unknown }).value)
        ) {
          // drizzle StringChunk — its .value is string[]
          text.push(((x as { value: string[] }).value ?? []).join(''));
        } else {
          flat.push((x as { value?: unknown })?.value ?? x);
        }
      }
    };
    walk(chunks as unknown[]);
    const entry = { text: text.join(' '), params: flat };
    state.executed = [...state.executed, entry];
    return entry;
  };
  const execute = async (query: unknown): Promise<unknown> => {
    const { text } = record(query);
    if (state.failWrites && /INSERT|DELETE/i.test(text)) {
      throw new Error('write refused');
    }
    if (/DELETE/i.test(text)) return { rows: state.deleteRows };
    if (/SELECT access_token_enc/i.test(text)) return { rows: state.selectRows };
    return { rows: [] };
  };
  return {
    databaseMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('db', {
        execute,
        transaction: async <T>(
          cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
        ): Promise<T> => cb({ execute }),
      });
      await next();
    },
  };
});

import { createConnectorsOAuthRouter } from '../integrations/connectors-oauth.hono.js';
import { createConnectorsRouter } from '../integrations/connectors.hono.js';
import { createConnectorTokenCipherFromKey } from '../../composition/connector-token-cipher.js';
import { encodeConnectorOAuthState } from '../../composition/connector-oauth-descriptors.js';

const ENV: NodeJS.ProcessEnv = {
  SLACK_CLIENT_ID: 'client-id-1',
  SLACK_CLIENT_SECRET: 'client-secret-XYZZY',
  CONNECTOR_OAUTH_REDIRECT_BASE: 'https://api.test.borjie.app',
  CONNECTOR_OAUTH_STATE_SECRET: 'route-test-state-secret',
};

const cipher = createConnectorTokenCipherFromKey('route-test-cipher-key');

const SLACK_TOKEN_PAYLOAD = {
  ok: true,
  access_token: 'xoxb-plaintext-token',
  token_type: 'Bearer',
  scope: 'chat:write,channels:history',
  bot_user_id: 'B1',
  team: { id: 'T-123', name: 'Acme' },
  enterprise: null,
  authed_user: { id: 'U1' },
};

interface BuildOpts {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly withCipher?: boolean;
}

function buildApp(opts: BuildOpts = {}): Hono {
  const app = new Hono();
  app.route(
    '/',
    createConnectorsOAuthRouter({
      env: opts.env ?? ENV,
      fetchImpl:
        opts.fetchImpl ??
        ((async () =>
          new Response(JSON.stringify(SLACK_TOKEN_PAYLOAD), {
            status: 200,
          })) as unknown as typeof fetch),
      cipher: opts.withCipher === false ? null : cipher,
    }),
  );
  return app;
}

function mintState(env: NodeJS.ProcessEnv = ENV, nowMs?: number): string {
  return encodeConnectorOAuthState(
    { tenantId: 't-1', userId: 'u-1', connectorId: 'slack' },
    env,
    nowMs,
  );
}

beforeEach(() => {
  state.tenantId = 't-1';
  state.selectRows = [];
  state.deleteRows = [];
  state.executed = [];
  state.failWrites = false;
});

// ─────────────────────────────────────────────────────────────────────
// POST /:connectorId/connect/start
// ─────────────────────────────────────────────────────────────────────

describe('POST /:connectorId/connect/start', () => {
  it('returns the honest provisioned:false envelope without provider env', async () => {
    const app = buildApp({
      env: { CONNECTOR_OAUTH_STATE_SECRET: 'route-test-state-secret' },
    });
    const res = await app.request('/slack/connect/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.provisioned).toBe(false);
    expect(body.data.reason).toContain('SLACK_CLIENT_ID');
  });

  it('returns a correct authorize URL with env — secret never in the body', async () => {
    const app = buildApp();
    const res = await app.request('/slack/connect/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('client-secret-XYZZY');
    const body = JSON.parse(raw);
    expect(body.data.provisioned).toBe(true);
    const url = new URL(body.data.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id-1');
    expect(url.searchParams.get('scope')).toContain('chat:write');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.test.borjie.app/api/v1/integrations/connectors/connect/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(body.data.stateExpiresAt).toBeTruthy();
  });

  it('degrades honestly for a connector with no OAuth descriptor', async () => {
    const app = buildApp();
    const res = await app.request('/github/connect/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.provisioned).toBe(false);
    expect(body.data.reason).toMatch(/no hosted OAuth/i);
  });

  it('rejects unknown connectors with 404 and missing tenant with 401', async () => {
    const app = buildApp();
    const notFound = await app.request('/nope/connect/start', { method: 'POST' });
    expect(notFound.status).toBe(404);

    state.tenantId = null;
    const unauthorized = await app.request('/slack/connect/start', {
      method: 'POST',
    });
    expect(unauthorized.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /connect/callback
// ─────────────────────────────────────────────────────────────────────

describe('GET /connect/callback', () => {
  it('exchanges the code, SEALS the token and upserts the state tenant row', async () => {
    const app = buildApp();
    const res = await app.request(
      `/connect/callback?code=the-code&state=${encodeURIComponent(mintState())}`,
      { method: 'GET', headers: { accept: 'application/json' } },
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    // Plaintext token and client secret NEVER appear in the response.
    expect(raw).not.toContain('xoxb-plaintext-token');
    expect(raw).not.toContain('client-secret-XYZZY');
    const body = JSON.parse(raw);
    expect(body.success).toBe(true);
    expect(body.data.connected).toBe(true);
    expect(body.data.connectorId).toBe('slack');
    expect(body.data.account).toBe('T-123');

    const insert = state.executed.find((e) => /INSERT INTO connector_credentials/i.test(e.text));
    expect(insert).toBeTruthy();
    expect(insert!.text).toContain('ON CONFLICT');
    // Tenant isolation: the write carries the STATE's tenant.
    expect(insert!.params).toContain('t-1');
    expect(insert!.params).toContain('slack');
    expect(insert!.params).toContain('T-123');
    // The stored token is CIPHERTEXT — decrypts back to the plaintext, and
    // the plaintext never appears among the raw SQL params.
    const sealed = insert!.params.find((p) => Buffer.isBuffer(p)) as Buffer;
    expect(sealed).toBeTruthy();
    await expect(cipher.open(new Uint8Array(sealed))).resolves.toBe(
      'xoxb-plaintext-token',
    );
    expect(
      insert!.params.some((p) => typeof p === 'string' && p.includes('xoxb')),
    ).toBe(false);
    // The RLS GUC was bound from the verified state inside the transaction.
    const guc = state.executed.find((e) => /set_config/i.test(e.text));
    expect(guc).toBeTruthy();
    expect(guc!.params).toContain('t-1');
  });

  it('returns a minimal static success page for browser callers', async () => {
    const app = buildApp();
    const res = await app.request(
      `/connect/callback?code=c&state=${encodeURIComponent(mintState())}`,
      { method: 'GET' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Slack connected');
    expect(html).not.toContain('xoxb');
  });

  it('rejects a tampered or expired state with 400, writing nothing', async () => {
    const app = buildApp();
    const tampered = await app.request(
      '/connect/callback?code=c&state=ev.il',
      { method: 'GET' },
    );
    expect(tampered.status).toBe(400);
    expect((await tampered.json()).error.code).toBe('INVALID_STATE');

    const expired = await app.request(
      `/connect/callback?code=c&state=${encodeURIComponent(
        mintState(ENV, Date.now() - 11 * 60 * 1000),
      )}`,
      { method: 'GET' },
    );
    expect(expired.status).toBe(400);
    expect(
      state.executed.some((e) => /INSERT INTO connector_credentials/i.test(e.text)),
    ).toBe(false);
  });

  it('rejects a REPLAYED state with 400 (single-use)', async () => {
    const app = buildApp();
    const oneState = mintState();
    const first = await app.request(
      `/connect/callback?code=c&state=${encodeURIComponent(oneState)}`,
      { method: 'GET', headers: { accept: 'application/json' } },
    );
    expect(first.status).toBe(200);
    const replay = await app.request(
      `/connect/callback?code=c2&state=${encodeURIComponent(oneState)}`,
      { method: 'GET', headers: { accept: 'application/json' } },
    );
    expect(replay.status).toBe(400);
    expect((await replay.json()).error.code).toBe('STATE_ALREADY_USED');
  });

  it('surfaces consent denial honestly, writing nothing', async () => {
    const app = buildApp();
    const res = await app.request(
      '/connect/callback?error=access_denied&error_description=user+said+no',
      { method: 'GET' },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('OAUTH_CONSENT_DENIED');
    expect(state.executed).toHaveLength(0);
  });

  it('returns 502 when the provider refuses the code — nothing written', async () => {
    const app = buildApp({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    const res = await app.request(
      `/connect/callback?code=bad&state=${encodeURIComponent(mintState())}`,
      { method: 'GET' },
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('OAUTH_EXCHANGE_FAILED');
    expect(body.error.message).toContain('invalid_code');
    expect(
      state.executed.some((e) => /INSERT/i.test(e.text)),
    ).toBe(false);
  });

  it('refuses to store an unsealable token (no cipher) with 503', async () => {
    const app = buildApp({ withCipher: false });
    const res = await app.request(
      `/connect/callback?code=c&state=${encodeURIComponent(mintState())}`,
      { method: 'GET' },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('TOKEN_CIPHER_NOT_PROVISIONED');
    expect(state.executed.some((e) => /INSERT/i.test(e.text))).toBe(false);
  });

  it('returns 500 and a token-free error when the upsert fails', async () => {
    state.failWrites = true;
    const app = buildApp();
    const res = await app.request(
      `/connect/callback?code=c&state=${encodeURIComponent(mintState())}`,
      { method: 'GET' },
    );
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain('xoxb');
    expect(JSON.parse(raw).error.code).toBe('CREDENTIAL_STORE_FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /:connectorId/disconnect
// ─────────────────────────────────────────────────────────────────────

describe('POST /:connectorId/disconnect', () => {
  it('best-effort revokes at the provider, then deletes the tenant rows', async () => {
    const sealed = Buffer.from(await cipher.seal('xoxb-stored-token'));
    state.selectRows = [{ access_token_enc: sealed }];
    state.deleteRows = [{ id: 'row-1' }];
    const revokeCalls: Array<{ url: unknown; auth: string | undefined }> = [];
    const app = buildApp({
      fetchImpl: (async (url: unknown, init: unknown) => {
        revokeCalls.push({
          url,
          auth: (init as { headers?: Record<string, string> })?.headers?.
            authorization,
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const res = await app.request('/slack/disconnect', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.disconnected).toBe(true);
    expect(body.data.removedAccounts).toBe(1);

    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0]!.url).toBe('https://slack.com/api/auth.revoke');
    expect(revokeCalls[0]!.auth).toBe('Bearer xoxb-stored-token');

    const del = state.executed.find((e) => /DELETE FROM connector_credentials/i.test(e.text));
    expect(del).toBeTruthy();
    expect(del!.params).toContain('t-1');
  });

  it('still deletes when the provider revoke fails (best-effort only)', async () => {
    state.selectRows = [
      { access_token_enc: Buffer.from(await cipher.seal('xoxb-x')) },
    ];
    state.deleteRows = [{ id: 'row-1' }];
    const app = buildApp({
      fetchImpl: (async () => {
        throw new Error('provider down');
      }) as unknown as typeof fetch,
    });
    const res = await app.request('/slack/disconnect', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.removedAccounts).toBe(1);
  });

  it('rejects missing tenant with 401 and unknown connector with 404', async () => {
    const app = buildApp();
    const notFound = await app.request('/nope/disconnect', { method: 'POST' });
    expect(notFound.status).toBe(404);

    state.tenantId = null;
    const unauthorized = await app.request('/slack/disconnect', {
      method: 'POST',
    });
    expect(unauthorized.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Mount — through createConnectorsRouter (the real composition path)
// ─────────────────────────────────────────────────────────────────────

describe('mount inside createConnectorsRouter', () => {
  it('the callback is reachable WITHOUT a JWT (state authenticates it)', async () => {
    state.tenantId = null; // no auth context at all
    const app = new Hono();
    app.route('/', createConnectorsRouter());
    const res = await app.request('/connect/callback', { method: 'GET' });
    // 400 (missing code/state) — NOT 401: the blanket auth middleware does
    // not gate the provider-initiated callback.
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('MISSING_CODE_OR_STATE');
  });

  it('start IS auth-gated through the composed router', async () => {
    state.tenantId = null;
    const app = new Hono();
    app.route('/', createConnectorsRouter());
    const res = await app.request('/slack/connect/start', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('the original fabric list route still works through the same mount', async () => {
    const app = new Hono();
    app.route('/', createConnectorsRouter());
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
