/**
 * MCP router — prompts dispatch coverage.
 *
 * Before Wave-K Fix-Agent C, the JSON-RPC dispatcher advertised the
 * `prompts: {}` capability in `initialize` but had no `prompts/list`
 * or `prompts/get` arm, so partners got `-32601 Method not found` back
 * — a protocol-conformance break. This suite locks the new dispatch
 * in place AND proves the advertised capability matches reality.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import mcpRouter from '../mcp.router';
import type {
  BossnyumbaMcpServer,
  McpAuthContext,
  McpScope,
  McpTier,
} from '@borjie/mcp-server';

// ---------------------------------------------------------------------------
// Fake MCP server — only the surface the router touches for prompts +
// the initialize capability handshake.
// ---------------------------------------------------------------------------

function makeContext(tier: McpTier, scopes: ReadonlyArray<McpScope>): McpAuthContext {
  return Object.freeze({
    tenantId: 'tenant-1',
    principalId: 'prin-1',
    principalType: 'api-key' as const,
    tier,
    scopes,
    issuedAt: 1_700_000_000_000,
    correlationId: 'corr-1',
  });
}

const ALL_SCOPES: ReadonlyArray<McpScope> = Object.freeze([
  'read:properties',
  'read:tenants',
  'read:cases',
  'write:cases',
  'read:letters',
  'write:letters',
  'read:payments',
  'read:occupancy',
  'read:graph',
  'read:warehouse',
  'read:taxonomy',
  'read:compliance',
  'read:ai-costs',
  'execute:skills',
]);

function makeFakeMcp(context: McpAuthContext): BossnyumbaMcpServer {
  return {
    config: Object.freeze({
      name: 'fake-mcp',
      version: '0.0.1',
      description: 'fake mcp for tests',
    }),
    tools: [],
    staticResources: [] as any,
    templateResources: [] as any,
    auth: {
      async authenticate() {
        return context;
      },
    },
    async invokeTool() {
      throw new Error('unused');
    },
    async readStaticResource() {
      return '{}';
    },
    async readTemplateResource() {
      return '{}';
    },
    async costSnapshot() {
      return {
        tenantId: context.tenantId,
        totalCostUsdMicro: 0,
        callCount: 0,
        freeCallCount: 0,
        paidCallCount: 0,
        costByTool: {},
        costByTier: { standard: 0, pro: 0, enterprise: 0 },
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      };
    },
    async flushCosts() {
      return 0;
    },
    shutdown() {},
  };
}

function buildApp(context: McpAuthContext): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { mcp: makeFakeMcp(context) });
    await next();
  });
  app.route('/', mcpRouter);
  return app;
}

interface JsonRpcOk {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result: any;
}
interface JsonRpcErr {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: any };
}

async function rpc<T extends JsonRpcOk | JsonRpcErr>(
  app: Hono,
  method: string,
  params: Record<string, unknown> | undefined = undefined,
  id: number | string = 1,
): Promise<T> {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP router — prompts capability matches dispatch', () => {
  it('initialize advertises the `prompts` capability', async () => {
    const app = buildApp(makeContext('enterprise', ALL_SCOPES));
    const out = await rpc<JsonRpcOk>(app, 'initialize');
    expect(out.result.capabilities.prompts).toBeDefined();
  });

  it('prompts/list returns every prompt for an enterprise caller with all scopes', async () => {
    const app = buildApp(makeContext('enterprise', ALL_SCOPES));
    const out = await rpc<JsonRpcOk>(app, 'prompts/list');
    expect(Array.isArray(out.result.prompts)).toBe(true);
    expect(out.result.prompts.length).toBe(5);
    const names = (out.result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toContain('Reconcile-Owner-Payout');
    expect(names).toContain('File-KRA-MRI');
  });

  it('prompts/list filters tier-locked prompts for a standard caller', async () => {
    // `File-KRA-MRI` and `Forecast-Occupancy-30d` require `pro` minimum;
    // a standard-tier caller must NOT see them.
    const app = buildApp(makeContext('standard', ALL_SCOPES));
    const out = await rpc<JsonRpcOk>(app, 'prompts/list');
    const names = (out.result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).not.toContain('File-KRA-MRI');
    expect(names).not.toContain('Forecast-Occupancy-30d');
    expect(names).toContain('Reconcile-Owner-Payout');
  });

  it('prompts/get renders a known prompt with valid args', async () => {
    const app = buildApp(makeContext('enterprise', ALL_SCOPES));
    const out = await rpc<JsonRpcOk>(app, 'prompts/get', {
      name: 'Reconcile-Owner-Payout',
      arguments: { propertyId: 'p-1', period: '2026-05' },
    });
    expect(out.result.description).toBeTruthy();
    expect(Array.isArray(out.result.messages)).toBe(true);
    expect(out.result.messages.length).toBeGreaterThan(0);
    // Confirm the rendered text actually carries the argument values
    // (so we know `arguments` were forwarded).
    const userMessage = (out.result.messages as Array<{ content: { text: string } }>)
      .map((m) => m.content.text)
      .join(' ');
    expect(userMessage).toContain('p-1');
    expect(userMessage).toContain('2026-05');
  });

  it('prompts/get returns -32601 for an unknown prompt name', async () => {
    const app = buildApp(makeContext('enterprise', ALL_SCOPES));
    const out = await rpc<JsonRpcErr>(app, 'prompts/get', {
      name: 'Does-Not-Exist',
      arguments: {},
    });
    expect(out.error.code).toBe(-32601);
    expect((out.error.data as { errorCode?: string }).errorCode).toBe('PROMPT_NOT_FOUND');
  });

  it('prompts/get returns -32602 when the caller tier is insufficient', async () => {
    // File-KRA-MRI minimumTier=pro; caller is standard.
    const app = buildApp(makeContext('standard', ALL_SCOPES));
    const out = await rpc<JsonRpcErr>(app, 'prompts/get', {
      name: 'File-KRA-MRI',
      arguments: { period: '2026-05' },
    });
    expect(out.error.code).toBe(-32602);
    expect((out.error.data as { errorCode?: string }).errorCode).toBe('TIER_INSUFFICIENT');
  });

  it('prompts/get returns -32602 when a required scope is missing', async () => {
    // Reconcile-Owner-Payout needs read:payments + read:properties.
    const partialScopes: ReadonlyArray<McpScope> = ['read:properties'];
    const app = buildApp(makeContext('enterprise', partialScopes));
    const out = await rpc<JsonRpcErr>(app, 'prompts/get', {
      name: 'Reconcile-Owner-Payout',
      arguments: { propertyId: 'p-1', period: '2026-05' },
    });
    expect(out.error.code).toBe(-32602);
    expect((out.error.data as { errorCode?: string }).errorCode).toBe('SCOPE_INSUFFICIENT');
  });

  it('prompts/get returns -32602 when a required argument is missing', async () => {
    const app = buildApp(makeContext('enterprise', ALL_SCOPES));
    const out = await rpc<JsonRpcErr>(app, 'prompts/get', {
      name: 'Reconcile-Owner-Payout',
      arguments: { propertyId: 'p-1' /* missing `period` */ },
    });
    expect(out.error.code).toBe(-32602);
    expect((out.error.data as { errorCode?: string }).errorCode).toBe('ARGUMENT_MISSING');
  });
});
