/**
 * Shared fixtures for MCP server tests.
 */

import type {
  ApiKeyRecord,
  ApiKeyRegistry,
  JwtClaims,
  JwtVerifier,
} from '../mcp-auth.js';
import type {
  McpAuthContext,
  McpScope,
  McpTier,
  McpToolHandler,
  HandlerMap,
} from '../index.js';
import { hashApiKey } from '../mcp-auth.js';
import type { ResourceResolvers } from '../mcp-resources.js';

export const ALL_SCOPES: ReadonlyArray<McpScope> = [
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
];

export async function makeApiKeyRegistry(
  records: ReadonlyArray<{
    readonly plainKey: string;
    readonly tenantId: string;
    readonly tier: McpTier;
    readonly scopes: ReadonlyArray<McpScope>;
    readonly status?: 'active' | 'revoked' | 'suspended';
  }>,
): Promise<ApiKeyRegistry> {
  const store = new Map<string, ApiKeyRecord>();
  for (const r of records) {
    const keyHash = await hashApiKey(r.plainKey);
    store.set(keyHash, {
      keyPrefix: r.plainKey.slice(0, 10),
      keyHash,
      tenantId: r.tenantId,
      principalId: `principal-${r.tenantId}`,
      tier: r.tier,
      scopes: r.scopes,
      status: r.status ?? 'active',
    });
  }
  return {
    async lookupByHash(hash) {
      return store.get(hash) ?? null;
    },
  };
}

export function makeJwtVerifier(
  tokenToClaims: Readonly<Record<string, JwtClaims>>,
): JwtVerifier {
  return {
    async verify(token) {
      return tokenToClaims[token] ?? null;
    },
  };
}

export function makeContext(
  overrides: Partial<McpAuthContext> = {},
): McpAuthContext {
  return {
    tenantId: 'tenant-a',
    principalId: 'principal-a',
    principalType: 'api-key',
    tier: 'pro',
    scopes: ALL_SCOPES,
    issuedAt: Date.now(),
    correlationId: 'test-correlation-id',
    ...overrides,
  };
}

export function makeHandlers(
  overrides: Partial<HandlerMap> = {},
): HandlerMap {
  const defaultEcho: McpToolHandler = async (input, context) => ({
    ok: true,
    data: { input, tenantId: context.tenantId },
  });
  return {
    query_property_graph: defaultEcho,
    get_tenant_risk_profile: defaultEcho,
    list_maintenance_cases: defaultEcho,
    create_maintenance_case: defaultEcho,
    generate_letter: defaultEcho,
    query_arrears_projection: defaultEcho,
    list_occupancy_timeline: defaultEcho,
    query_ai_cost_summary: defaultEcho,
    list_compliance_plugins: defaultEcho,
    get_maintenance_taxonomy: defaultEcho,
    get_warehouse_inventory: defaultEcho,
    ...overrides,
  };
}

export function makeResourceResolvers(): ResourceResolvers {
  const stub = async (
    _context: McpAuthContext,
  ): Promise<Record<string, unknown>> => ({ ok: true });
  return {
    portfolioOverview: stub,
    activeCompliancePlugins: stub,
    monthlyKpis: stub,
    maintenanceTaxonomy: stub,
    warehouseInventory: stub,
    tenantProfile: async (id) => ({ id }),
    propertyDetail: async (id) => ({ id }),
    unitDetail: async (id) => ({ id }),
    caseDetail: async (id) => ({ id }),
    graphEntity: async (id) => ({ id }),
  };
}
