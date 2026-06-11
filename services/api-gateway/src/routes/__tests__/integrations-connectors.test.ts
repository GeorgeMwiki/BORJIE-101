/**
 * /api/v1/integrations/connectors — universal integration fabric route tests.
 *
 * Verifies the GENERIC dispatch surface over the 21-connector catalog:
 *   - GET / lists the full catalog with per-tenant connection state
 *   - the honest { connected:false, reason } envelope (never fake data)
 *   - the honest { provisioned:false, reason } envelope (no invoker bound)
 *   - the happy invoke path through a bound invoker (services seam)
 *   - unknown connector → 404, unknown action → 400, bad input → 400
 *   - auth rejection when no tenant scope
 *   - tenant isolation: credential lookups carry the caller's tenantId
 *
 * Unit test against the router only — auth + database middlewares are
 * stubbed (no live Postgres), mirroring me-jurisdiction.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mutable per-test behavior for the stubbed middlewares.
const state = vi.hoisted(() => ({
  tenantId: 't-1' as string | null,
  // Rows the fake connector_credentials store returns; null = store down.
  credentialRows: [] as Array<Record<string, unknown>> | null,
  // Captures the SQL params each execute() call received.
  executedParams: [] as unknown[][],
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

vi.mock('../../middleware/database.js', () => ({
  databaseMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', {
      async execute(query: unknown) {
        const params =
          (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
        state.executedParams = [...state.executedParams, params];
        if (state.credentialRows === null) {
          throw new Error('connection refused');
        }
        return { rows: state.credentialRows };
      },
    });
    await next();
  },
}));

import { createConnectorsRouter } from '../integrations/connectors.hono.js';
import { CONNECTOR_CATALOG } from '../../composition/connector-catalog.js';

function buildApp(services?: Record<string, unknown>): Hono {
  const app = new Hono();
  if (services) {
    app.use('*', async (c, next) => {
      c.set('services' as never, services as never);
      await next();
    });
  }
  app.route('/', createConnectorsRouter());
  return app;
}

const SLACK_ROW = {
  connector_kind: 'slack',
  connector_account: 'T-WORKSPACE-1',
  scopes: ['channels:history', 'chat:write'],
  expires_at: null,
};

beforeEach(() => {
  state.tenantId = 't-1';
  state.credentialRows = [];
  state.executedParams = [];
});

describe('GET /api/v1/integrations/connectors (fabric list)', () => {
  it('lists the full catalog with per-tenant connection state', async () => {
    state.credentialRows = [SLACK_ROW];
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(CONNECTOR_CATALOG.length);
    expect(body.data.connectors).toHaveLength(CONNECTOR_CATALOG.length);

    const slack = body.data.connectors.find(
      (c: { id: string }) => c.id === 'slack',
    );
    expect(slack.connected).toBe(true);
    expect(slack.accountCount).toBe(1);

    const github = body.data.connectors.find(
      (c: { id: string }) => c.id === 'github',
    );
    expect(github.connected).toBe(false);
    expect(github.reason).toMatch(/not connected/i);
  });

  it('degrades honestly when the credential store is unreachable', async () => {
    state.credentialRows = null; // execute() throws
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const slack = body.data.connectors.find(
      (c: { id: string }) => c.id === 'slack',
    );
    expect(slack.connected).toBe(false);
    expect(slack.reason).toMatch(/store unreachable/i);
  });

  it('rejects requests without tenant scope', async () => {
    state.tenantId = null;
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NO_TENANT');
  });
});

describe('GET /api/v1/integrations/connectors/:id/status', () => {
  it('returns connected accounts for a connected connector', async () => {
    state.credentialRows = [SLACK_ROW];
    const app = buildApp();
    const res = await app.request('/slack/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.connected).toBe(true);
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.accounts[0].account).toBe('T-WORKSPACE-1');
    expect(body.data.accounts[0].scopes).toContain('chat:write');
  });

  it('returns 404 for an unknown connector', async () => {
    const app = buildApp();
    const res = await app.request('/not-a-connector/status', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('UNKNOWN_CONNECTOR');
  });
});

describe('POST /api/v1/integrations/connectors/:id/invoke', () => {
  it('returns the honest not-connected envelope (never fake data)', async () => {
    state.credentialRows = []; // tenant connected nothing
    const app = buildApp();
    const res = await app.request('/github/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync.pull' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(false);
    expect(body.data.invoked).toBe(false);
    expect(body.data.connected).toBe(false);
    expect(body.data.reason).toMatch(/not connected/i);
    expect(body.data.reason).toMatch(/no data was fabricated/i);
  });

  it('returns the honest not-provisioned envelope when no invoker is bound', async () => {
    state.credentialRows = [SLACK_ROW];
    const app = buildApp(); // no services.connectorInvokers
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'message.post', input: { text: 'hi' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.connected).toBe(true);
    expect(body.data.provisioned).toBe(false);
    expect(body.data.reason).toMatch(/not provisioned/i);
  });

  it('invokes through a bound invoker (generic services seam)', async () => {
    state.credentialRows = [SLACK_ROW];
    const calls: unknown[] = [];
    const app = buildApp({
      connectorInvokers: {
        slack: async (req: unknown) => {
          calls.push(req);
          return { posted: true, channel: '#ops' };
        },
      },
    });
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'message.post', input: { text: 'hi' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.invoked).toBe(true);
    expect(body.data.provisioned).toBe(true);
    expect(body.data.result).toEqual({ posted: true, channel: '#ops' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'message.post',
      input: { text: 'hi' },
    });
  });

  it('returns 502 when the bound invoker fails (message only, no stack)', async () => {
    state.credentialRows = [SLACK_ROW];
    const app = buildApp({
      connectorInvokers: {
        slack: async () => {
          throw new Error('slack api 429');
        },
      },
    });
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'message.post' }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('CONNECTOR_INVOKE_FAILED');
    expect(body.error.message).toBe('slack api 429');
  });

  it('rejects an unknown connector with 404', async () => {
    const app = buildApp();
    const res = await app.request('/nope/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync.pull' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown action with 400 + the available action ids', async () => {
    state.credentialRows = [SLACK_ROW];
    const app = buildApp();
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete.everything' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNKNOWN_ACTION');
    expect(body.error.message).toContain('sync.pull');
  });

  it('rejects invalid input with 400 (zod-validated)', async () => {
    const app = buildApp();
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text: 'hi' } }), // action missing
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_INPUT');
  });

  it('rejects requests without tenant scope', async () => {
    state.tenantId = null;
    const app = buildApp();
    const res = await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync.pull' }),
    });
    expect(res.status).toBe(401);
  });

  it('binds the caller tenantId into every credential lookup (isolation)', async () => {
    state.credentialRows = [];
    const app = buildApp();
    await app.request('/slack/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync.pull' }),
    });
    // drizzle sql`` template params land in queryChunks; the bound
    // tenant id must be the caller's, never another tenant's.
    const flattened = JSON.stringify(state.executedParams);
    expect(flattened).toContain('t-1');
  });
});
