/**
 * Analytics-aggregate task — Wave WS-4.
 *
 * Recomputes the three owner-portal Analytics warehouses (migrations
 * 0175/0176/0177 → `analytics_usage_daily`, `analytics_growth_monthly`) for
 * every active tenant, on a schedule. The gateway routers then serve REAL
 * series from these tables (no more `X-Backend-Status: degraded`).
 *
 * Source of truth for the aggregation logic lives in
 * `@borjie/database` (`aggregateUsageDaily` / `aggregateGrowthMonthly`) so the
 * exact same UPSERT runs whether triggered by this cron or a future on-demand
 * recompute. This module is the orchestration shell:
 *
 *   - PURE orchestrator (`runAnalyticsAggregate`): tests inject fakes for the
 *     tenant lister + the two aggregators; no DB needed.
 *   - Idempotent: the aggregators UPSERT on the warehouse grain
 *     ((tenant_id, day, dimension) / (tenant_id, period)) so re-running the
 *     window overwrites rather than double-counts.
 *   - Never throws: a single bad tenant is caught + logged so it cannot poison
 *     the batch.
 *
 * Money model (CLAUDE.md): the growth aggregator SUMs already-posted
 * `ledger_entries` and resolves `currency` from those lines (never hardcoded);
 * it writes NO ledger line. The default currency (used only when a tenant has
 * zero ledger lines in the month) is the tenant's `primary_currency`.
 */

import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface AnalyticsTenant {
  readonly tenantId: string;
  /** Tenant's primary currency — the growth fallback when no ledger lines. */
  readonly primaryCurrency: string;
}

export interface AnalyticsAggregateResult {
  readonly scanned: number;
  readonly usageUpserted: number;
  readonly growthUpserted: number;
  readonly failed: number;
}

/** Lists the tenants whose warehouses should be recomputed this run. */
export interface AnalyticsTenantLister {
  list(): Promise<ReadonlyArray<AnalyticsTenant>>;
}

/** The two aggregation ports (defaults wrap the @borjie/database fns). */
export interface AnalyticsAggregators {
  usageDaily(tenantId: string, from: Date, to: Date): Promise<{ upserted: number }>;
  growthMonthly(
    tenantId: string,
    monthAnchor: Date,
    defaultCurrency: string,
  ): Promise<{ upserted: number }>;
}

export interface AnalyticsAggregateDeps {
  readonly tenants: AnalyticsTenantLister;
  readonly aggregators: AnalyticsAggregators;
}

export interface AnalyticsAggregateOptions {
  /** "Now" override for deterministic tests. Defaults to `new Date()`. */
  readonly now?: Date;
  /** How many trailing days of usage to recompute. Default 30. */
  readonly usageLookbackDays?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Pure orchestrator
// ─────────────────────────────────────────────────────────────────────

/**
 * Recompute the usage (trailing N days) + growth (current month) warehouses
 * for every listed tenant. Never throws — per-tenant failures are counted.
 */
export async function runAnalyticsAggregate(
  deps: AnalyticsAggregateDeps,
  options: AnalyticsAggregateOptions = {},
): Promise<AnalyticsAggregateResult> {
  const now = options.now ?? new Date();
  const lookbackDays = options.usageLookbackDays ?? 30;

  const usageFrom = new Date(now.getTime());
  usageFrom.setUTCDate(usageFrom.getUTCDate() - lookbackDays);

  let usageUpserted = 0;
  let growthUpserted = 0;
  let failed = 0;
  let scanned = 0;

  const tenants = await deps.tenants.list();
  for (const tenant of tenants) {
    scanned += 1;
    try {
      const usage = await deps.aggregators.usageDaily(tenant.tenantId, usageFrom, now);
      usageUpserted += usage.upserted;

      const growth = await deps.aggregators.growthMonthly(
        tenant.tenantId,
        now,
        tenant.primaryCurrency,
      );
      growthUpserted += growth.upserted;
    } catch (err) {
      failed += 1;
      logger.error('analytics_aggregate_tenant_failed', {
        tenantId: tenant.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('analytics_aggregate_run_complete', {
    scanned,
    usageUpserted,
    growthUpserted,
    failed,
  });
  return { scanned, usageUpserted, growthUpserted, failed };
}

// ─────────────────────────────────────────────────────────────────────
// Default (Postgres-backed) ports
// ─────────────────────────────────────────────────────────────────────

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Default tenant lister: every tenant that has at least one active site OR a
 * posted ledger line OR an audit event (i.e. has something worth aggregating).
 * Returns the tenant id + its `primary_currency`.
 */
export function defaultAnalyticsTenantLister(db: DbLike): AnalyticsTenantLister {
  return {
    async list(): Promise<ReadonlyArray<AnalyticsTenant>> {
      const { sql } = await import('drizzle-orm');
      const result = await db.execute(sql`
        SELECT t.id::text AS tenant_id, t.primary_currency AS primary_currency
        FROM tenants t
        WHERE EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id = t.id)
           OR EXISTS (SELECT 1 FROM ledger_entries l WHERE l.tenant_id = t.id)
           OR EXISTS (SELECT 1 FROM audit_events a WHERE a.tenant_id = t.id)
      `);
      const rows = rowsOf(result) as ReadonlyArray<{
        tenant_id?: unknown;
        primary_currency?: unknown;
      }>;
      const out: AnalyticsTenant[] = [];
      for (const r of rows) {
        const tenantId = asString(r.tenant_id);
        const primaryCurrency = asString(r.primary_currency);
        if (tenantId && primaryCurrency) {
          out.push({ tenantId, primaryCurrency });
        }
      }
      return out;
    },
  };
}

/**
 * Default aggregators: thin wrappers over the @borjie/database functions. The
 * worker connects as the Supabase service_role (BYPASSRLS); the aggregators'
 * explicit `tenant_id = :tenantId` predicates are the scoping boundary, and we
 * additionally bind the tenant GUC per call for defence-in-depth + parity with
 * the gateway path.
 */
export function defaultAnalyticsAggregators(
  db: unknown,
): AnalyticsAggregators {
  return {
    async usageDaily(tenantId: string, from: Date, to: Date) {
      const { aggregateUsageDaily } = await import('@borjie/database');
      await bindTenant(db as DbLike, tenantId);
      return aggregateUsageDaily(
        db as Parameters<typeof aggregateUsageDaily>[0],
        tenantId,
        { from, to },
      );
    },
    async growthMonthly(tenantId: string, monthAnchor: Date, defaultCurrency: string) {
      const { aggregateGrowthMonthly } = await import('@borjie/database');
      await bindTenant(db as DbLike, tenantId);
      return aggregateGrowthMonthly(
        db as Parameters<typeof aggregateGrowthMonthly>[0],
        tenantId,
        monthAnchor,
        defaultCurrency,
      );
    },
  };
}

async function bindTenant(db: DbLike, tenantId: string): Promise<void> {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`);
}

// ─────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
