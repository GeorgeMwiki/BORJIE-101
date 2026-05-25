import { describe, expect, it } from 'vitest';
import {
  createBossnyumbaMcpServer,
  createMcpAuth,
  createInMemoryCostLedger,
  type McpToolHandler,
} from '../index.js';
import {
  ALL_SCOPES,
  makeContext,
  makeHandlers,
  makeResourceResolvers,
} from './test-fixtures.js';

describe('cost persistence', () => {
  it('records a cost entry on every tool call (even failures)', async () => {
    const ledger = createInMemoryCostLedger();
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers({
        list_maintenance_cases: async () => ({
          ok: false,
          error: 'boom',
          errorCode: 'TOOL_EXECUTION_FAILED',
        }),
      }),
      resourceResolvers: makeResourceResolvers(),
      costLedger: ledger,
    });

    await server.invokeTool('list_maintenance_cases', {}, makeContext());
    await server.invokeTool(
      'get_tenant_risk_profile',
      { tenantProfileId: 'tp' },
      makeContext(),
    );
    await server.flushCosts();

    const snap = await ledger.snapshot('tenant-a');
    expect(snap.callCount).toBe(2);
    // Failed call is free, successful call is paid.
    expect(snap.freeCallCount).toBeGreaterThanOrEqual(1);
    server.shutdown();
  });
});

describe('universal tool adapter', () => {
  it('validates required inputs before executing', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const r = await server.invokeTool(
      'create_maintenance_case',
      { unitId: 'u1' /* missing problemCode, description */ },
      makeContext({ tier: 'pro' }),
    );
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.errorCode).toBe('TOOL_INVALID_INPUT');
    }
    server.shutdown();
  });

  it('enforces scope requirements — a caller without write:cases cannot create_maintenance_case', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const withoutWrite = ALL_SCOPES.filter((s) => s !== 'write:cases');
    const r = await server.invokeTool(
      'create_maintenance_case',
      {
        unitId: 'u1',
        problemCode: 'leak',
        description: 'water',
      },
      makeContext({ tier: 'pro', scopes: withoutWrite }),
    );
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.errorCode).toBe('AUTH_SCOPE_DENIED');
    server.shutdown();
  });

  it('gates premium tools behind the tier router', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const r = await server.invokeTool(
      'list_compliance_plugins',
      {},
      makeContext({ tier: 'pro' }), // enterprise-only tool
    );
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect([
        'TIER_INSUFFICIENT',
        'TIER_TOOL_NOT_ALLOWED',
      ]).toContain(r.result.errorCode);
    }

    const ok = await server.invokeTool(
      'list_compliance_plugins',
      {},
      makeContext({ tier: 'enterprise' }),
    );
    expect(ok.result.ok).toBe(true);
    server.shutdown();
  });

  it('catches handler exceptions and converts them to a structured failure', async () => {
    const throwing: McpToolHandler = async () => {
      throw new Error('kaboom');
    };
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers({ list_maintenance_cases: throwing }),
      resourceResolvers: makeResourceResolvers(),
    });
    const r = await server.invokeTool(
      'list_maintenance_cases',
      {},
      makeContext(),
    );
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.errorCode).toBe('TOOL_EXECUTION_FAILED');
      expect(r.result.error).toContain('kaboom');
    }
    server.shutdown();
  });

  it('rejects oversized input payloads', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const huge = 'x'.repeat(1_000_001);
    const r = await server.invokeTool(
      'query_property_graph',
      { query: huge },
      makeContext(),
    );
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.errorCode).toBe('TOOL_INVALID_INPUT');
    server.shutdown();
  });

  it('run_skill dispatches to the named tool on enterprise tier', async () => {
    const server = createBossnyumbaMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const r = await server.invokeTool(
      'run_skill',
      {
        skillName: 'list_maintenance_cases',
        input: { status: 'open' },
      },
      makeContext({ tier: 'enterprise' }),
    );
    expect(r.result.ok).toBe(true);
    if (r.result.ok) {
      const data = r.result.data as { skillName: string };
      expect(data.skillName).toBe('list_maintenance_cases');
    }
    server.shutdown();
  });
});
