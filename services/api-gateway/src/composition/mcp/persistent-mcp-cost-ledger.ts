/**
 * Persistent MCP cost ledger — Drizzle-backed `CostLedgerPort`.
 *
 * Replaces the in-memory `createInMemoryCostLedger()` (which resets on every
 * restart) with a durable writer against `mcp_cost_ledger` (migration 0301).
 * Every metered MCP tool call is INSERTed; `snapshot(tenantId)` and the
 * extra `aggregateByServer(tenantId)` / `aggregateByTool(tenantId)` read APIs
 * compute spend with a read-time SUM — so "spend per MCP server, per tenant"
 * survives deploys and is queryable across replicas.
 *
 * FAIL-SOFT (CLAUDE.md "fail-soft metering"): an MCP tool call must NEVER fail
 * because the cost ledger is unavailable. Every write swallows its error
 * (logged via Pino, counted) and returns; reads degrade to an empty snapshot.
 * Cost metering is observability, not the money path — the immutable
 * double-entry invariant lives in `LedgerService.post()`, not here.
 *
 * TENANT ISOLATION (two layers):
 *   1. RLS — `mcp_cost_ledger` FORCE-enables row-level security on the
 *      canonical `app.current_tenant_id` GUC. Because MCP cost writes happen
 *      OUTSIDE the request `databaseMiddleware` (inside the batcher's flush),
 *      every read/write runs inside `withTenantContext(db, tenantId, …)` so
 *      the GUC is bound on the checked-out connection.
 *   2. Defence-in-depth — every row carries `tenantId`; every aggregate read
 *      filters by the caller-supplied `tenantId`.
 *
 * No `console.log` — Pino only.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { mcpCostLedger, withTenantContext } from '@borjie/database';
import type {
  CostLedgerPort,
  McpCostEntry,
  McpCostSnapshot,
  McpTier,
} from '@borjie/mcp-server';

import { logger } from '../../utils/logger.js';

/**
 * Drizzle client seam. The fluent builder generics cannot be reproduced
 * through the `@borjie/database` barrel without tripping TS2709 (see
 * `stage/drizzle-stage-advisor-db.ts` for the rationale) — so we accept the
 * structural minimum and map every row through an explicit converter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

const DEFAULT_SERVER_NAME = 'borjie-mcp-server';

const ZERO_COST_BY_TIER: Readonly<Record<McpTier, number>> = Object.freeze({
  standard: 0,
  pro: 0,
  enterprise: 0,
});

/** A per-server (or per-tool) spend roll-up returned by the read APIs. */
export interface McpSpendBucket {
  readonly key: string;
  readonly totalUsdCost: number;
  readonly totalUsdCostMicro: number;
  readonly callCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * The persisted ledger — implements the MCP server's `CostLedgerPort` plus
 * the extra aggregate read APIs the cost dashboards / budget guards consume.
 */
export interface PersistentMcpCostLedger extends CostLedgerPort {
  aggregateByServer(
    tenantId: string,
    sincePeriodStart?: boolean,
  ): Promise<ReadonlyArray<McpSpendBucket>>;
  aggregateByTool(
    tenantId: string,
    sincePeriodStart?: boolean,
  ): Promise<ReadonlyArray<McpSpendBucket>>;
}

export interface CreatePersistentMcpCostLedgerOptions {
  /** Logical server name stamped on rows that omit one. */
  readonly serverName?: string;
  /** Inject the current time (deterministic period boundaries in tests). */
  readonly now?: () => Date;
}

/** USD micro-dollars (1e-6) — the integer unit the MCP snapshot uses. */
function toUsdMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

function monthBoundsIso(now: Date): {
  readonly periodStart: string;
  readonly periodStartDate: Date;
  readonly periodEnd: string;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    periodStart: start.toISOString(),
    periodStartDate: start,
    periodEnd: end.toISOString(),
  };
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the Drizzle-backed cost ledger. `db` is the gateway's singleton
 * Drizzle client (`getDb()`); pass `null` to get a no-op ledger that always
 * fails soft (used when DATABASE_URL is unset).
 */
export function createPersistentMcpCostLedger(
  db: DrizzleLike | null,
  options: CreatePersistentMcpCostLedgerOptions = {},
): PersistentMcpCostLedger {
  const serverName = options.serverName ?? DEFAULT_SERVER_NAME;
  const now = options.now ?? (() => new Date());

  const emptySnapshot = (tenantId: string): McpCostSnapshot => {
    const { periodStart, periodEnd } = monthBoundsIso(now());
    return {
      tenantId,
      totalCostUsdMicro: 0,
      callCount: 0,
      freeCallCount: 0,
      paidCallCount: 0,
      costByTool: {},
      costByTier: ZERO_COST_BY_TIER,
      periodStart,
      periodEnd,
    };
  };

  async function record(entry: McpCostEntry): Promise<void> {
    if (!db) return; // no DB ⇒ fail soft (metering is non-critical)
    const usd =
      (entry.actualCostUsdMicro ?? entry.estimatedCostUsdMicro) / 1_000_000;
    try {
      await withTenantContext(db, entry.tenantId, async (tx: DrizzleLike) => {
        await tx.insert(mcpCostLedger).values({
          tenantId: entry.tenantId,
          serverName,
          toolName: entry.toolName,
          inputTokens: Math.max(0, Math.round(entry.inputTokens ?? 0)),
          outputTokens: Math.max(0, Math.round(entry.outputTokens ?? 0)),
          // numeric columns take a string in drizzle-orm/postgres-js.
          usdCost: Math.max(0, usd).toString(),
          wasFree: entry.wasFree,
          requestId: entry.correlationId ?? null,
          occurredAt: new Date(entry.timestamp),
        });
      });
    } catch (err) {
      // FAIL-SOFT: never let a metering write break the MCP call.
      logger.warn(
        {
          component: 'mcp-cost-ledger',
          tenantId: entry.tenantId,
          toolName: entry.toolName,
          error: err instanceof Error ? err.message : String(err),
        },
        'mcp cost ledger write failed (fail-soft, entry dropped)',
      );
    }
  }

  async function snapshot(tenantId: string): Promise<McpCostSnapshot> {
    if (!db) return emptySnapshot(tenantId);
    const { periodStart, periodStartDate, periodEnd } = monthBoundsIso(now());
    try {
      return await withTenantContext(
        db,
        tenantId,
        async (tx: DrizzleLike) => {
          // Per-tool roll-up for the current month, scoped by tenant (RLS +
          // explicit predicate). Drizzle's group-by builder is typed loosely
          // through the seam, so we read columns back off the raw rows.
          const raw = await tx
            .select({
              toolName: mcpCostLedger.toolName,
              totalUsd: sql<string>`COALESCE(SUM(${mcpCostLedger.usdCost}), 0)`,
              calls: sql<number>`COUNT(*)`,
              freeCalls: sql<number>`COUNT(*) FILTER (WHERE ${mcpCostLedger.wasFree})`,
            })
            .from(mcpCostLedger)
            .where(
              and(
                eq(mcpCostLedger.tenantId, tenantId),
                gte(mcpCostLedger.occurredAt, periodStartDate),
              ),
            )
            .groupBy(mcpCostLedger.toolName);

          const rows = rowsOf(raw);
          const costByTool: Record<string, number> = {};
          let totalCostUsdMicro = 0;
          let callCount = 0;
          let freeCallCount = 0;
          for (const r of rows) {
            const usdMicro = toUsdMicro(num(r.totalUsd));
            const tool = String(r.toolName ?? 'unknown');
            costByTool[tool] = (costByTool[tool] ?? 0) + usdMicro;
            totalCostUsdMicro += usdMicro;
            callCount += num(r.calls);
            freeCallCount += num(r.freeCalls);
          }

          return {
            tenantId,
            totalCostUsdMicro,
            callCount,
            freeCallCount,
            paidCallCount: Math.max(0, callCount - freeCallCount),
            costByTool,
            // Tier is not persisted on the row (it lives on the auth
            // principal, not the cost fact); report zeros honestly rather
            // than fabricate a breakdown.
            costByTier: ZERO_COST_BY_TIER,
            periodStart,
            periodEnd,
          };
        },
      );
    } catch (err) {
      logger.warn(
        {
          component: 'mcp-cost-ledger',
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        },
        'mcp cost ledger snapshot failed (fail-soft, returning empty)',
      );
      return emptySnapshot(tenantId);
    }
  }

  async function aggregateBy(
    tenantId: string,
    column: typeof mcpCostLedger.serverName | typeof mcpCostLedger.toolName,
    sincePeriodStart: boolean,
  ): Promise<ReadonlyArray<McpSpendBucket>> {
    if (!db) return [];
    const { periodStartDate } = monthBoundsIso(now());
    try {
      return await withTenantContext(
        db,
        tenantId,
        async (tx: DrizzleLike) => {
          const predicates = [eq(mcpCostLedger.tenantId, tenantId)];
          if (sincePeriodStart) {
            predicates.push(gte(mcpCostLedger.occurredAt, periodStartDate));
          }
          const raw = await tx
            .select({
              key: column,
              totalUsd: sql<string>`COALESCE(SUM(${mcpCostLedger.usdCost}), 0)`,
              calls: sql<number>`COUNT(*)`,
              inTok: sql<number>`COALESCE(SUM(${mcpCostLedger.inputTokens}), 0)`,
              outTok: sql<number>`COALESCE(SUM(${mcpCostLedger.outputTokens}), 0)`,
            })
            .from(mcpCostLedger)
            .where(and(...predicates))
            .groupBy(column);

          return rowsOf(raw).map((r) => {
            const totalUsd = num(r.totalUsd);
            return Object.freeze({
              key: String(r.key ?? 'unknown'),
              totalUsdCost: totalUsd,
              totalUsdCostMicro: toUsdMicro(totalUsd),
              callCount: num(r.calls),
              inputTokens: num(r.inTok),
              outputTokens: num(r.outTok),
            });
          });
        },
      );
    } catch (err) {
      logger.warn(
        {
          component: 'mcp-cost-ledger',
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        },
        'mcp cost ledger aggregate failed (fail-soft, returning empty)',
      );
      return [];
    }
  }

  return Object.freeze({
    record,
    snapshot,
    aggregateByServer(tenantId, sincePeriodStart = true) {
      return aggregateBy(tenantId, mcpCostLedger.serverName, sincePeriodStart);
    },
    aggregateByTool(tenantId, sincePeriodStart = true) {
      return aggregateBy(tenantId, mcpCostLedger.toolName, sincePeriodStart);
    },
  });
}
