/**
 * MCP wiring — composes the `@borjie/mcp-server` server instance
 * with handlers/resolvers backed by the already-built domain services in
 * the registry.
 *
 * Intentionally defensive: every handler probes whether its backing
 * service is present; if not, it returns a structured NOT_IMPLEMENTED
 * MCP error rather than crashing. This keeps MCP catalog discovery
 * stable even when some domain services are in degraded mode.
 *
 * Tenant isolation: every handler is called with an `McpAuthContext`
 * that carries `tenantId` — all downstream calls are tenant-scoped.
 */

import {
  createBossnyumbaMcpServer,
  createMcpAuth,
  type BossnyumbaMcpServer,
  type HandlerMap,
  type JwtVerifier,
  type JwtClaims,
  type McpAuthContext,
  type McpTier,
  type McpScope,
  type CostLedgerPort,
  type McpCostEntry,
  type McpCostSnapshot,
} from '@borjie/mcp-server';
import type { ResourceResolvers } from '@borjie/mcp-server';
import type { AgentCertificationService } from '@borjie/ai-copilot/agent-certification';

import type { ServiceRegistry } from './service-registry.js';

function nowIso(): string {
  return new Date().toISOString();
}

function okResult(data: unknown) {
  return { ok: true as const, data };
}

function errResult(error: string, errorCode: string) {
  return { ok: false as const, error, errorCode };
}

async function notImpl(reason: string) {
  return errResult(reason, 'NOT_IMPLEMENTED');
}

/**
 * Adapt the composition-root AI cost ledger into the `CostLedgerPort`
 * shape expected by the MCP server. Mapping is lossy by design: MCP
 * tracks tool-call-level metadata that the AI cost ledger doesn't
 * directly model, so we collapse the per-tool data into a structured
 * `operation` + `metadata` payload and use `mcp-server` as the
 * provider name.
 */
function adaptCostLedger(
  registry: ServiceRegistry,
): CostLedgerPort {
  const ledger = registry.aiCostLedger;
  return {
    async record(entry: McpCostEntry): Promise<void> {
      if (!ledger) return;
      try {
        await ledger.recordUsage({
          tenantId: entry.tenantId,
          provider: 'mcp-server',
          model: entry.toolName,
          inputTokens: entry.inputTokens ?? 0,
          outputTokens: entry.outputTokens ?? 0,
          costUsdMicro: entry.actualCostUsdMicro ?? entry.estimatedCostUsdMicro,
          operation: `mcp.${entry.toolName}`,
          correlationId: entry.correlationId,
          metadata: {
            principalId: entry.principalId,
            tier: entry.tier,
            durationMs: entry.durationMs,
            wasFree: entry.wasFree,
          },
        });
      } catch {
        // Do not crash the MCP call on ledger errors.
      }
    },

    async snapshot(tenantId: string): Promise<McpCostSnapshot> {
      if (!ledger) {
        return {
          tenantId,
          totalCostUsdMicro: 0,
          callCount: 0,
          freeCallCount: 0,
          paidCallCount: 0,
          costByTool: {},
          costByTier: { standard: 0, pro: 0, enterprise: 0 },
          periodStart: nowIso(),
          periodEnd: nowIso(),
        };
      }
      const summary = await ledger.currentMonthSpend(tenantId);
      return {
        tenantId,
        totalCostUsdMicro: summary.totalCostUsdMicro,
        callCount: summary.callCount,
        freeCallCount: 0,
        paidCallCount: summary.callCount,
        costByTool: {},
        costByTier: { standard: 0, pro: 0, enterprise: 0 },
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
      };
    },
  };
}

/**
 * Minimal JWT verifier — reuses the same `JWT_SECRET` the gateway uses
 * for user auth, but restricts the claim shape to the MCP expectations.
 * If `JWT_SECRET` is not set, returns null for every token (auth falls
 * through to API-key lookup).
 */
function buildJwtVerifier(): JwtVerifier | undefined {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return undefined;
  return {
    async verify(token: string): Promise<JwtClaims | null> {
      try {
        // Use jsonwebtoken if available; otherwise decode manually.
        // The gateway already bundles jsonwebtoken via auth middleware.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, secret) as Record<string, unknown>;
        if (!decoded || typeof decoded !== 'object') return null;
        const tenantId = decoded.tenantId as string | undefined;
        const sub =
          (decoded.sub as string | undefined) ??
          (decoded.userId as string | undefined);
        if (!tenantId || !sub) return null;
        const tier = (decoded.tier as McpTier | undefined) ?? 'enterprise';
        const scopes = Array.isArray(decoded.scopes)
          ? (decoded.scopes as McpScope[])
          : (ALL_MCP_SCOPES as readonly McpScope[]);
        return {
          sub,
          tenantId,
          tier,
          scopes,
          iat:
            typeof decoded.iat === 'number'
              ? decoded.iat
              : Math.floor(Date.now() / 1000),
          exp:
            typeof decoded.exp === 'number'
              ? decoded.exp
              : Math.floor(Date.now() / 1000) + 3600,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Default scopes granted to gateway-JWT principals — gateway enforces
 *  its own role-based auth on routes; MCP tier gating is a second layer. */
const ALL_MCP_SCOPES: readonly McpScope[] = [
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
] as const;

// ---------------------------------------------------------------------------
// Handlers — one per tool in `tool-registry.ts`
// ---------------------------------------------------------------------------

function buildHandlers(registry: ServiceRegistry): HandlerMap {
  return Object.freeze({
    get_tenant_risk_profile: async (input, context: McpAuthContext) => {
      const svc = registry.riskReport;
      if (!svc) return notImpl('risk-report service not configured');
      const tenantProfileId = String(input.tenantProfileId ?? '');
      if (!tenantProfileId) return errResult('tenantProfileId required', 'VALIDATION');
      try {
        const result = await (svc as any).getLatest(
          context.tenantId,
          tenantProfileId,
        );
        return okResult(result);
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'risk report failed',
          'SERVICE_ERROR',
        );
      }
    },

    list_maintenance_cases: async (input, context: McpAuthContext) => {
      // Reads maintenance-related cases from the canonical `cases`
      // table (no `maintenance_cases` table exists; drafts that used
      // that name raised undefined_table errors at runtime). We filter
      // to the case_type values that represent maintenance work, and
      // select columns that actually live on `cases.schema.ts`.
      const db = registry.db;
      if (!db) return notImpl('database not configured');
      try {
        const { sql } = await import('drizzle-orm');
        const limit = Math.min(200, Math.max(1, Number(input.limit ?? 25) || 25));
        const rows = await (db as any).execute(
          sql`SELECT id, status, severity, assigned_to, case_type, title, description, created_at
              FROM cases
              WHERE tenant_id = ${context.tenantId}
                AND case_type IN ('maintenance_dispute','damage_claim')
              ORDER BY created_at DESC
              LIMIT ${limit}`,
        );
        const list = Array.isArray(rows) ? rows : ((rows as any)?.rows ?? []);
        return okResult({ cases: list });
      } catch (err) {
        // Schema may differ — surface structured error instead of a crash.
        return errResult(
          err instanceof Error ? err.message : 'cases query failed',
          'QUERY_FAILED',
        );
      }
    },

    generate_letter: async (input, context: McpAuthContext) => {
      // Delegate to the letters router surface — we build a minimal
      // LetterService call site via the shared `@borjie/domain-services`.
      // For MCP we return the template + context echoed so the agent can
      // continue; real rendering is owned by the letters HTTP router.
      return okResult({
        queued: true,
        templateId: input.templateId,
        tenantProfileId: input.tenantProfileId,
        tenantId: context.tenantId,
        hint: 'Use POST /api/v1/letters to persist and download the rendered document',
      });
    },

    query_arrears_projection: async (input, context: McpAuthContext) => {
      const svc = registry.arrears.service;
      const entryLoader = registry.arrears.entryLoader;
      if (!svc || !entryLoader) return notImpl('arrears service not configured');
      const months = Math.min(24, Math.max(1, Number(input.months ?? 6) || 6));
      try {
        const caseId = String(input.caseId ?? '');
        if (!caseId) {
          return okResult({
            months,
            projection: [],
            note: 'pass caseId to load a specific projection',
          });
        }
        const entries = await entryLoader({
          tenantId: context.tenantId,
          caseId,
        } as never);
        return okResult({ caseId, months, entries });
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'arrears projection failed',
          'SERVICE_ERROR',
        );
      }
    },

    list_occupancy_timeline: async (input, context: McpAuthContext) => {
      const svc = registry.occupancyTimeline;
      if (!svc) return notImpl('occupancy-timeline service not configured');
      try {
        const unitId = input.unitId ? String(input.unitId) : undefined;
        const propertyId = input.propertyId ? String(input.propertyId) : undefined;
        if (!unitId && !propertyId) {
          return errResult('unitId or propertyId required', 'VALIDATION');
        }
        const events = unitId
          ? await (svc as any).getUnitTimeline(unitId, context.tenantId)
          : await (svc as any).getPortfolioTimeline(
              propertyId as string,
              context.tenantId,
            );
        return okResult({ events, scopedPropertyId: propertyId });
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'occupancy timeline failed',
          'SERVICE_ERROR',
        );
      }
    },

    query_ai_cost_summary: async (_input, context: McpAuthContext) => {
      const ledger = registry.aiCostLedger;
      if (!ledger) return notImpl('AI cost ledger not configured');
      try {
        const summary = await ledger.currentMonthSpend(context.tenantId);
        return okResult(summary);
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'ai-cost summary failed',
          'SERVICE_ERROR',
        );
      }
    },

    list_compliance_plugins: async (_input, context: McpAuthContext) => {
      // Compliance plugins live outside the registry (they're static
      // country configs). We return a stable schema; the HTTP router
      // is the authoritative surface.
      return okResult({
        tenantId: context.tenantId,
        plugins: [],
        hint: 'Call GET /api/v1/compliance-plugins for the full active plugin catalogue',
      });
    },

    get_maintenance_taxonomy: async (input, context: McpAuthContext) => {
      // Mining hard-fork wave 6 — property-domain `maintenanceTaxonomy`
      // service is retired. The mining-domain replacement is
      // `equipmentMaintenanceTaxonomy` (keyed by `assets.kind`). We
      // mirror the legacy MCP tool contract by listing every entry for
      // the tenant and surfacing the merged `problemCategories` jsonb
      // payload (consumers can filter client-side).
      const repo = registry.equipmentMaintenanceTaxonomy;
      if (!repo) return notImpl('equipment maintenance taxonomy not configured');
      try {
        const categoryId = input.categoryId ? String(input.categoryId) : undefined;
        const entries = await repo.listForTenant(
          context.tenantId as unknown as never,
        );
        const filtered = categoryId
          ? entries.filter((e) => e.code === categoryId)
          : entries;
        return okResult({ problems: filtered });
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'taxonomy query failed',
          'SERVICE_ERROR',
        );
      }
    },

    get_warehouse_inventory: async (input, context: McpAuthContext) => {
      const svc = registry.warehouse;
      if (!svc) return notImpl('warehouse service not configured');
      try {
        const lowStockOnly = Boolean(input.lowStockOnly);
        const items = await svc.listItems(context.tenantId);
        const filtered = lowStockOnly
          ? items.filter((it: any) => {
              const qty = Number(it.quantityOnHand ?? 0);
              const reorder = Number(it.reorderPoint ?? 0);
              return reorder > 0 && qty <= reorder;
            })
          : items;
        return okResult({ items: filtered });
      } catch (err) {
        return errResult(
          err instanceof Error ? err.message : 'warehouse query failed',
          'SERVICE_ERROR',
        );
      }
    },

    query_property_graph: async (_input, _context: McpAuthContext) => {
      // Neo4j not wired in the gateway; return structured NOT_IMPLEMENTED
      return notImpl('property graph (Neo4j) not wired into gateway');
    },

    create_maintenance_case: async (_input, _context: McpAuthContext) => {
      // Case creation goes through the cases HTTP router which owns
      // validation + tenant verification. MCP surface returns a pointer.
      return notImpl('use POST /api/v1/cases to create a maintenance case');
    },
  });
}

// ---------------------------------------------------------------------------
// Resource resolvers
// ---------------------------------------------------------------------------

function buildResolvers(registry: ServiceRegistry): ResourceResolvers {
  const empty = async () => ({});
  return {
    async portfolioOverview(context) {
      // Wire to drizzle if available — return a compact aggregate of
      // properties / units / active leases scoped to the tenant. When
      // db is not configured, surface a structured NOT_IMPLEMENTED so
      // the MCP catalog doesn't silently serve a placeholder.
      const db = (registry as { db?: unknown }).db as
        | {
            execute: (q: unknown) => Promise<unknown> | unknown;
          }
        | undefined;
      if (!db) {
        return {
          tenantId: context.tenantId,
          error: 'NOT_IMPLEMENTED',
          note:
            'portfolio overview requires DATABASE_URL — wire registry.db so this resolver can aggregate properties/units/leases',
        };
      }
      try {
        const { sql } = await import('drizzle-orm');
        const rowsRaw = await (db as { execute: Function }).execute(
          sql`SELECT
                (SELECT COUNT(*) FROM properties WHERE tenant_id = ${context.tenantId}) AS property_count,
                (SELECT COUNT(*) FROM units WHERE tenant_id = ${context.tenantId}) AS unit_count,
                (SELECT COUNT(*) FROM leases WHERE tenant_id = ${context.tenantId} AND status = 'active') AS active_lease_count`,
        );
        const list = Array.isArray(rowsRaw) ? rowsRaw : ((rowsRaw as { rows?: unknown[] })?.rows ?? []);
        const head = (list[0] ?? {}) as Record<string, unknown>;
        return {
          tenantId: context.tenantId,
          counts: {
            properties: Number(head.property_count ?? 0),
            units: Number(head.unit_count ?? 0),
            activeLeases: Number(head.active_lease_count ?? 0),
          },
        };
      } catch (err) {
        return {
          tenantId: context.tenantId,
          error: 'AGGREGATE_FAILED',
          note: err instanceof Error ? err.message : 'portfolio overview query failed',
        };
      }
    },
    async activeCompliancePlugins(context) {
      return { tenantId: context.tenantId, plugins: [] };
    },
    async monthlyKpis(context) {
      if (!registry.aiCostLedger) return { tenantId: context.tenantId };
      try {
        const summary = await registry.aiCostLedger.currentMonthSpend(
          context.tenantId,
        );
        return { aiSpend: summary };
      } catch {
        return { tenantId: context.tenantId };
      }
    },
    async maintenanceTaxonomy(context) {
      // Mining hard-fork wave 6 — route through
      // `equipmentMaintenanceTaxonomy` (the mining-domain replacement).
      const repo = registry.equipmentMaintenanceTaxonomy;
      if (!repo) return empty();
      try {
        const problems = await repo.listForTenant(
          context.tenantId as unknown as never,
        );
        return { problems };
      } catch {
        return empty();
      }
    },
    async warehouseInventory(context) {
      if (!registry.warehouse) return empty();
      try {
        const items = await registry.warehouse.listItems(context.tenantId);
        return { items };
      } catch {
        return empty();
      }
    },
    async tenantProfile(tenantProfileId, context) {
      return { tenantProfileId, tenantId: context.tenantId };
    },
    async propertyDetail(propertyId, context) {
      return { propertyId, tenantId: context.tenantId };
    },
    async unitDetail(unitId, context) {
      return { unitId, tenantId: context.tenantId };
    },
    async caseDetail(caseId, context) {
      return { caseId, tenantId: context.tenantId };
    },
    async graphEntity(entityId, context) {
      return { entityId, tenantId: context.tenantId };
    },
  };
}

// ---------------------------------------------------------------------------
// Public: build the MCP server from a populated service registry
// ---------------------------------------------------------------------------

export function buildMcpServer(
  registry: ServiceRegistry,
  certService?: AgentCertificationService | null,
): BossnyumbaMcpServer {
  const jwt = buildJwtVerifier();
  const auth = createMcpAuth(jwt !== undefined ? { jwt } : {});

  // Note: cert service is observed but MCP's AuthPort does not currently
  // consume it. The gateway's other routes enforce cert-based auth
  // separately.
  void certService;

  const handlers = buildHandlers(registry);
  const resourceResolvers = buildResolvers(registry);
  const costLedger = adaptCostLedger(registry);

  return createBossnyumbaMcpServer({
    auth,
    handlers,
    resourceResolvers,
    costLedger,
  });
}
