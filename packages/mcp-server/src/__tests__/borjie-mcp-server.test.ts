import { describe, expect, it } from 'vitest';
import {
  createBossnyumbaMcpServer,
  createMcpAuth,
  createTierRouter,
  BORJIE_TOOLS,
  BORJIE_STATIC_RESOURCES,
} from '../index.js';
import {
  ALL_SCOPES,
  makeApiKeyRegistry,
  makeContext,
  makeHandlers,
  makeJwtVerifier,
  makeResourceResolvers,
} from './test-fixtures.js';

describe('createBossnyumbaMcpServer', () => {
  it('starts and exposes every tool in the canonical registry', () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });

    expect(server.tools.length).toBe(BORJIE_TOOLS.length);
    const toolNames = server.tools.map((t) => t.name);
    expect(toolNames).toContain('query_property_graph');
    expect(toolNames).toContain('get_tenant_risk_profile');
    expect(toolNames).toContain('list_maintenance_cases');
    expect(toolNames).toContain('create_maintenance_case');
    expect(toolNames).toContain('generate_letter');
    expect(toolNames).toContain('query_arrears_projection');
    expect(toolNames).toContain('list_occupancy_timeline');
    expect(toolNames).toContain('query_ai_cost_summary');
    expect(toolNames).toContain('list_compliance_plugins');
    expect(toolNames).toContain('get_maintenance_taxonomy');
    expect(toolNames).toContain('get_warehouse_inventory');
    expect(toolNames).toContain('run_skill');
    expect(server.staticResources.length).toBe(
      BORJIE_STATIC_RESOURCES.length,
    );
    server.shutdown();
  });

  it('invokes a tool end-to-end and returns tenant-scoped data', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const result = await server.invokeTool(
      'list_maintenance_cases',
      { status: 'open' },
      makeContext({ tenantId: 'tenant-alpha' }),
    );
    expect(result.result.ok).toBe(true);
    if (result.result.ok) {
      const data = result.result.data as { tenantId: string };
      expect(data.tenantId).toBe('tenant-alpha');
    }
    server.shutdown();
  });

  it('returns TOOL_NOT_FOUND for an unregistered tool', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const r = await server.invokeTool('i-do-not-exist', {}, makeContext());
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.errorCode).toBe('TOOL_NOT_FOUND');
    server.shutdown();
  });

  it('returns tenant-scoped resources from static URIs', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const json = await server.readStaticResource(
      'borjie://portfolio/overview',
      makeContext({ tenantId: 'tenant-z' }),
    );
    const parsed = JSON.parse(json) as { tenantId: string };
    expect(parsed.tenantId).toBe('tenant-z');
    server.shutdown();
  });
});

describe('mcp-auth', () => {
  it('rejects requests with no credentials', async () => {
    const auth = createMcpAuth({});
    const res = await auth.authenticate({ headers: {} });
    expect('ok' in res && res.ok === false).toBe(true);
    if ('ok' in res && res.ok === false) {
      expect(res.errorCode).toBe('AUTH_REQUIRED');
      expect(res.status).toBe(401);
    }
  });

  it('authenticates with a valid API key and returns tenant context', async () => {
    const registry = await makeApiKeyRegistry([
      {
        plainKey: 'bnk_mcp_valid_key',
        tenantId: 'tenant-x',
        tier: 'pro',
        scopes: ALL_SCOPES,
      },
    ]);
    const auth = createMcpAuth({ apiKeys: registry });
    const res = await auth.authenticate({
      headers: { 'x-api-key': 'bnk_mcp_valid_key' },
    });
    expect('tenantId' in res).toBe(true);
    if ('tenantId' in res) {
      expect(res.tenantId).toBe('tenant-x');
      expect(res.tier).toBe('pro');
      expect(res.principalType).toBe('api-key');
    }
  });

  it('rejects an invalid API key', async () => {
    const registry = await makeApiKeyRegistry([
      {
        plainKey: 'bnk_mcp_valid',
        tenantId: 't',
        tier: 'pro',
        scopes: ALL_SCOPES,
      },
    ]);
    const auth = createMcpAuth({ apiKeys: registry });
    const res = await auth.authenticate({
      headers: { 'x-api-key': 'bnk_mcp_invalid' },
    });
    expect('ok' in res && res.ok === false).toBe(true);
    if ('ok' in res && res.ok === false) {
      expect(res.errorCode).toBe('AUTH_INVALID_KEY');
    }
  });

  it('rejects a revoked API key', async () => {
    const registry = await makeApiKeyRegistry([
      {
        plainKey: 'bnk_mcp_gone',
        tenantId: 't',
        tier: 'pro',
        scopes: ALL_SCOPES,
        status: 'revoked',
      },
    ]);
    const auth = createMcpAuth({ apiKeys: registry });
    const res = await auth.authenticate({
      headers: { 'x-api-key': 'bnk_mcp_gone' },
    });
    expect('ok' in res && res.ok === false).toBe(true);
    if ('ok' in res && res.ok === false) {
      expect(res.errorCode).toBe('AUTH_REVOKED');
    }
  });

  it('authenticates via JWT', async () => {
    const verifier = makeJwtVerifier({
      'good-token': {
        sub: 'user-1',
        tenantId: 'tenant-y',
        tier: 'enterprise',
        scopes: ALL_SCOPES,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    const auth = createMcpAuth({ jwt: verifier });
    const res = await auth.authenticate({
      headers: { authorization: 'Bearer good-token' },
    });
    expect('tenantId' in res).toBe(true);
    if ('tenantId' in res) {
      expect(res.tenantId).toBe('tenant-y');
      expect(res.principalType).toBe('jwt');
    }
  });

  it('rejects a request carrying a different tenant than the key maps to', async () => {
    // This is the key isolation test: even if the caller tries to
    // claim they are tenant-b via some out-of-band mechanism, the
    // auth module only ever returns the tenantId stored in the key.
    const registry = await makeApiKeyRegistry([
      {
        plainKey: 'bnk_mcp_a',
        tenantId: 'tenant-a',
        tier: 'pro',
        scopes: ALL_SCOPES,
      },
    ]);
    const auth = createMcpAuth({ apiKeys: registry });
    const res = await auth.authenticate({
      headers: {
        'x-api-key': 'bnk_mcp_a',
        // Attempted impersonation header — must be ignored.
        'x-tenant-id': 'tenant-b',
      },
    });
    expect('tenantId' in res && res.tenantId === 'tenant-a').toBe(true);
  });
});

describe('tier router', () => {
  const router = createTierRouter();
  const createCase = BORJIE_TOOLS.find(
    (t) => t.name === 'create_maintenance_case',
  )!;
  const runSkill = BORJIE_TOOLS.find((t) => t.name === 'run_skill')!;
  const listCases = BORJIE_TOOLS.find(
    (t) => t.name === 'list_maintenance_cases',
  )!;

  it('denies create_maintenance_case on standard tier', () => {
    const d = router.canInvoke(createCase, 'standard');
    expect(d.allowed).toBe(false);
    expect(['TIER_INSUFFICIENT', 'TIER_TOOL_NOT_ALLOWED']).toContain(
      d.errorCode,
    );
  });

  it('allows create_maintenance_case on pro tier', () => {
    expect(router.canInvoke(createCase, 'pro').allowed).toBe(true);
  });

  it('denies run_skill except on enterprise', () => {
    expect(router.canInvoke(runSkill, 'pro').allowed).toBe(false);
    expect(router.canInvoke(runSkill, 'enterprise').allowed).toBe(true);
  });

  it('allows list_maintenance_cases on every tier', () => {
    expect(router.canInvoke(listCases, 'standard').allowed).toBe(true);
    expect(router.canInvoke(listCases, 'pro').allowed).toBe(true);
    expect(router.canInvoke(listCases, 'enterprise').allowed).toBe(true);
  });

  it('denies a call that would exceed the monthly budget', () => {
    const d = router.canAfford(
      50_000,
      'standard',
      /* monthly spent close to cap */ 9_990_000,
    );
    expect(d.allowed).toBe(false);
    expect(d.errorCode).toBe('TIER_MONTHLY_BUDGET_EXCEEDED');
  });
});
