import { describe, expect, it } from 'vitest';
import {
  createBorjieMcpServer,
  createMcpAuth,
  createInMemoryCostLedger,
  type McpToolHandler,
} from '../index.js';
import {
  makeContext,
  makeHandlers,
  makeResourceResolvers,
} from './test-fixtures.js';

describe('tenant isolation', () => {
  it('query_property_graph handler receives the caller tenantId in context', async () => {
    const seen: string[] = [];
    const handler: McpToolHandler = async (_input, context) => {
      seen.push(context.tenantId);
      return { ok: true, data: { tenantId: context.tenantId } };
    };

    const server = createBorjieMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers({ query_property_graph: handler }),
      resourceResolvers: makeResourceResolvers(),
    });

    await server.invokeTool(
      'query_property_graph',
      { query: 'MATCH (p:Property) RETURN p' },
      makeContext({ tenantId: 'tenant-1' }),
    );
    await server.invokeTool(
      'query_property_graph',
      { query: 'MATCH (p:Property) RETURN p' },
      makeContext({ tenantId: 'tenant-2' }),
    );

    expect(seen).toEqual(['tenant-1', 'tenant-2']);
    server.shutdown();
  });

  it('cost entries are tenant-scoped — one tenant cannot see another tenant spend', async () => {
    const ledger = createInMemoryCostLedger();
    const server = createBorjieMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
      costLedger: ledger,
    });

    await server.invokeTool(
      'list_maintenance_cases',
      {},
      makeContext({ tenantId: 'tenant-a' }),
    );
    await server.invokeTool(
      'list_maintenance_cases',
      {},
      makeContext({ tenantId: 'tenant-b' }),
    );
    await server.invokeTool(
      'get_tenant_risk_profile',
      { tenantProfileId: 'tp-1' },
      makeContext({ tenantId: 'tenant-a' }),
    );

    await server.flushCosts();

    const a = await server.costSnapshot('tenant-a');
    const b = await server.costSnapshot('tenant-b');
    expect(a.callCount).toBe(2);
    expect(b.callCount).toBe(1);
    expect(a.tenantId).toBe('tenant-a');
    expect(b.tenantId).toBe('tenant-b');
    server.shutdown();
  });

  it('resolves template resources with the calling tenant injected into the payload', async () => {
    const server = createBorjieMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    const out = await server.readTemplateResource(
      'borjie://tenant/{tenantProfileId}',
      { tenantProfileId: 'tp-42' },
      makeContext({ tenantId: 'tenant-Q' }),
    );
    const parsed = JSON.parse(out) as {
      tenantId: string;
      id: string;
    };
    expect(parsed.tenantId).toBe('tenant-Q');
    expect(parsed.id).toBe('tp-42');
    server.shutdown();
  });

  it('rejects path-traversal attempts in template variables', async () => {
    const server = createBorjieMcpServer({
      auth: createMcpAuth({}),
      handlers: makeHandlers(),
      resourceResolvers: makeResourceResolvers(),
    });
    await expect(
      server.readTemplateResource(
        'borjie://tenant/{tenantProfileId}',
        { tenantProfileId: '../../etc/passwd' },
        makeContext(),
      ),
    ).rejects.toThrow(/Invalid resource variable/);
    server.shutdown();
  });
});
