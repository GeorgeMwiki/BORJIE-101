/**
 * Analytics warehouse repository — reads + aggregations for the three
 * owner-portal Analytics warehouses (migrations 0175/0176/0177).
 *
 * Two roles, one module:
 *   - READ (gateway): `usageSeries` / `growthSeries` / `listExportTemplates`
 *     return tenant-scoped series the routers serve. They run on whatever
 *     Drizzle client is passed; the gateway passes the RLS-PINNED request
 *     client (`c.get('db')`), so tenant isolation is enforced by RLS on the
 *     reserved connection — the explicit `eq(tenant_id, …)` predicate is
 *     belt-and-braces, NOT the security boundary.
 *   - AGGREGATE (consolidation-worker): `aggregateUsageDaily` /
 *     `aggregateGrowthMonthly` recompute a tenant's buckets from the source
 *     tables (`audit_events`, sites→production→sales→ledger) and UPSERT them
 *     on the warehouse's idempotent grain — a re-run never double-counts.
 *
 * Money model (CLAUDE.md): every money figure is BIGINT minor units; the
 * growth roll-up carries an ISO-4217 `currency` resolved from the tenant's
 * already-posted ledger lines (never hardcoded). This module SUMs
 * already-posted `ledger_entries` — it NEVER writes a ledger line (the money
 * path stays on LedgerService.post()).
 *
 * Every function is small, pure-ish (no module state), and immutable in its
 * inputs.
 */

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  analyticsUsageDaily,
  analyticsGrowthMonthly,
  analyticsExportTemplates,
} from '../schemas/analytics-warehouse.schema.js';

// ---------------------------------------------------------------------------
// Public row shapes (the gateway serialises these directly).
// ---------------------------------------------------------------------------

export interface UsageSeriesPoint {
  readonly date: string; // ISO yyyy-mm-dd (the warehouse `day`)
  readonly dimension: string;
  readonly count: number;
}

export interface GrowthSeriesPoint {
  readonly period: string; // ISO yyyy-mm-dd (first day of month)
  readonly activeSites: number;
  readonly productionKg: number;
  readonly salesCount: number;
  /** BIGINT minor units — the gateway threads `currency` into formatCurrency. */
  readonly revenueMinorUnits: number;
  readonly royaltyMinorUnits: number;
  readonly currency: string;
}

export interface ExportTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly schema: unknown;
  readonly createdAt: Date;
}

/** A bounded reporting window. Both ends are inclusive of whole UTC days. */
export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

// ===========================================================================
// READ — usage series (GET /api/v1/analytics/usage)
// ===========================================================================

/**
 * Return the per-day feature-usage series for a tenant, newest day first.
 * Optionally filtered to a single `dimension`. Bounded by `range` when
 * supplied (defaults to the most recent `limit` rows otherwise).
 */
export async function usageSeries(
  db: DatabaseClient,
  tenantId: string,
  opts: { readonly dimension?: string; readonly range?: DateRange; readonly limit?: number } = {},
): Promise<UsageSeriesPoint[]> {
  const limit = clampLimit(opts.limit);
  const conds = [eq(analyticsUsageDaily.tenantId, tenantId)];
  if (opts.dimension) {
    conds.push(eq(analyticsUsageDaily.dimension, opts.dimension));
  }
  if (opts.range) {
    conds.push(gte(analyticsUsageDaily.day, isoDay(opts.range.from)));
    conds.push(lt(analyticsUsageDaily.day, isoDayExclusiveEnd(opts.range.to)));
  }
  const rows = await db
    .select({
      day: analyticsUsageDaily.day,
      dimension: analyticsUsageDaily.dimension,
      count: analyticsUsageDaily.count,
    })
    .from(analyticsUsageDaily)
    .where(and(...conds))
    .orderBy(desc(analyticsUsageDaily.day))
    .limit(limit);

  return rows.map((r) => ({
    date: String(r.day),
    dimension: r.dimension,
    count: Number(r.count),
  }));
}

// ===========================================================================
// READ — growth series (GET /api/v1/analytics/growth)
// ===========================================================================

/**
 * Return the per-month growth series for a tenant, newest month first.
 * Bounded by `range` when supplied.
 */
export async function growthSeries(
  db: DatabaseClient,
  tenantId: string,
  opts: { readonly range?: DateRange; readonly limit?: number } = {},
): Promise<GrowthSeriesPoint[]> {
  const limit = clampLimit(opts.limit);
  const conds = [eq(analyticsGrowthMonthly.tenantId, tenantId)];
  if (opts.range) {
    conds.push(gte(analyticsGrowthMonthly.period, isoDay(opts.range.from)));
    conds.push(lt(analyticsGrowthMonthly.period, isoDayExclusiveEnd(opts.range.to)));
  }
  const rows = await db
    .select()
    .from(analyticsGrowthMonthly)
    .where(and(...conds))
    .orderBy(desc(analyticsGrowthMonthly.period))
    .limit(limit);

  return rows.map((r) => ({
    period: String(r.period),
    activeSites: Number(r.activeSites),
    productionKg: Number(r.productionKg),
    salesCount: Number(r.salesCount),
    revenueMinorUnits: Number(r.revenueMinorUnits),
    royaltyMinorUnits: Number(r.royaltyMinorUnits),
    currency: r.currency,
  }));
}

// ===========================================================================
// READ — export templates (GET /api/v1/analytics/exports/templates)
// ===========================================================================

export async function listExportTemplates(
  db: DatabaseClient,
  tenantId: string,
  opts: { readonly limit?: number } = {},
): Promise<ExportTemplateRow[]> {
  const limit = clampLimit(opts.limit);
  const rows = await db
    .select({
      id: analyticsExportTemplates.id,
      name: analyticsExportTemplates.name,
      kind: analyticsExportTemplates.kind,
      schema: analyticsExportTemplates.schema,
      createdAt: analyticsExportTemplates.createdAt,
    })
    .from(analyticsExportTemplates)
    .where(eq(analyticsExportTemplates.tenantId, tenantId))
    .orderBy(desc(analyticsExportTemplates.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    schema: r.schema,
    createdAt: r.createdAt,
  }));
}

// ===========================================================================
// AGGREGATE — usage (consolidation-worker)
// ===========================================================================

export interface AggregateResult {
  readonly upserted: number;
}

/**
 * Recompute a tenant's daily usage buckets from `audit_events` over
 * `[range.from, range.to)` and UPSERT them into `analytics_usage_daily`.
 *
 * The bucket key is `(day, category)` — `category` is the audit dimension
 * the owner-portal pivots on. Idempotent: the warehouse's
 * (tenant_id, day, dimension) unique drives an UPSERT, so re-running over the
 * same window overwrites the bucket count rather than adding to it.
 *
 * Runs on the passed client; the worker binds the tenant GUC for its
 * connection (the `tenant_id = :tenantId` predicate + RLS both apply).
 */
export async function aggregateUsageDaily(
  db: DatabaseClient,
  tenantId: string,
  range: DateRange,
): Promise<AggregateResult> {
  const fromIso = isoDay(range.from);
  const toIso = isoDayExclusiveEnd(range.to);

  // Group source audit_events into (day, category) buckets. `timestamp` is
  // TIMESTAMPTZ; truncate to UTC day. We read the canonical audit_events
  // table (the richer module, mirrored by the AuditEvents namespace).
  const buckets = await db.execute<{ day: string; dimension: string; cnt: string }>(sql`
    SELECT to_char(date_trunc('day', timestamp AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
           category::text AS dimension,
           COUNT(*)::text AS cnt
    FROM audit_events
    WHERE tenant_id = ${tenantId}
      AND timestamp >= ${fromIso}::date
      AND timestamp <  ${toIso}::date
    GROUP BY 1, 2
  `);

  const rows = extractRows<{ day: string; dimension: string; cnt: string }>(buckets);
  if (rows.length === 0) return { upserted: 0 };

  let upserted = 0;
  for (const b of rows) {
    await db
      .insert(analyticsUsageDaily)
      .values({
        id: `aud_${tenantId}_${b.day}_${b.dimension}`,
        tenantId,
        day: b.day,
        dimension: b.dimension,
        count: Number(b.cnt),
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          analyticsUsageDaily.tenantId,
          analyticsUsageDaily.day,
          analyticsUsageDaily.dimension,
        ],
        set: { count: Number(b.cnt), computedAt: new Date() },
      });
    upserted += 1;
  }
  return { upserted };
}

// ===========================================================================
// AGGREGATE — growth (consolidation-worker)
// ===========================================================================

/**
 * Recompute a tenant's growth row for the month containing `monthAnchor`
 * from the mining domain and UPSERT it into `analytics_growth_monthly`.
 *
 *   active_sites        ← COUNT(sites WHERE status='active')
 *   production_kg       ← SUM(production_records.mass_kg) in the month
 *   sales_count         ← COUNT(sales) in the month
 *   revenue_minor_units ← SUM(ledger CREDIT lines, EXCLUDING royalty, in month)
 *   royalty_minor_units ← SUM(ledger_entries WHERE type ILIKE '%ROYALTY%')
 *
 * Revenue excludes royalty lines (royalty is a state payable, not the tenant's
 * revenue) so the two columns never double-count the same money.
 *
 * `currency` is taken from the tenant's ledger lines in the window (the modal
 * currency); falls back to `defaultCurrency` only when the tenant has zero
 * ledger lines that month — NEVER a hardcoded literal. Idempotent on
 * (tenant_id, period). This SUMs already-posted ledger lines; it writes none.
 */
export async function aggregateGrowthMonthly(
  db: DatabaseClient,
  tenantId: string,
  monthAnchor: Date,
  defaultCurrency: string,
): Promise<AggregateResult> {
  const periodIso = firstOfMonthIso(monthAnchor);
  const nextMonthIso = firstOfNextMonthIso(monthAnchor);

  const agg = await db.execute<{
    active_sites: string;
    production_kg: string | null;
    sales_count: string;
    revenue: string | null;
    royalty: string | null;
    currency: string | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM sites
         WHERE tenant_id = ${tenantId} AND status = 'active')::text AS active_sites,
      (SELECT COALESCE(SUM(mass_kg), 0) FROM production_records
         WHERE tenant_id = ${tenantId}
           AND ts >= ${periodIso}::date AND ts < ${nextMonthIso}::date)::text AS production_kg,
      (SELECT COUNT(*) FROM sales
         WHERE tenant_id = ${tenantId}
           AND ts >= ${periodIso}::date AND ts < ${nextMonthIso}::date)::text AS sales_count,
      (SELECT COALESCE(SUM(amount_minor_units), 0) FROM ledger_entries
         WHERE tenant_id = ${tenantId} AND direction = 'CREDIT'
           AND type NOT ILIKE '%ROYALTY%'
           AND posted_at >= ${periodIso}::date AND posted_at < ${nextMonthIso}::date)::text AS revenue,
      (SELECT COALESCE(SUM(amount_minor_units), 0) FROM ledger_entries
         WHERE tenant_id = ${tenantId} AND type ILIKE '%ROYALTY%'
           AND posted_at >= ${periodIso}::date AND posted_at < ${nextMonthIso}::date)::text AS royalty,
      (SELECT currency FROM ledger_entries
         WHERE tenant_id = ${tenantId}
           AND posted_at >= ${periodIso}::date AND posted_at < ${nextMonthIso}::date
         GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1) AS currency
  `);

  const row = extractRows<{
    active_sites: string;
    production_kg: string | null;
    sales_count: string;
    revenue: string | null;
    royalty: string | null;
    currency: string | null;
  }>(agg)[0];

  const currency = row?.currency ?? defaultCurrency;
  await db
    .insert(analyticsGrowthMonthly)
    .values({
      id: `agr_${tenantId}_${periodIso}`,
      tenantId,
      period: periodIso,
      activeSites: Number(row?.active_sites ?? 0),
      productionKg: Math.round(Number(row?.production_kg ?? 0)),
      salesCount: Number(row?.sales_count ?? 0),
      revenueMinorUnits: Number(row?.revenue ?? 0),
      royaltyMinorUnits: Number(row?.royalty ?? 0),
      currency,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [analyticsGrowthMonthly.tenantId, analyticsGrowthMonthly.period],
      set: {
        activeSites: Number(row?.active_sites ?? 0),
        productionKg: Math.round(Number(row?.production_kg ?? 0)),
        salesCount: Number(row?.sales_count ?? 0),
        revenueMinorUnits: Number(row?.revenue ?? 0),
        royaltyMinorUnits: Number(row?.royalty ?? 0),
        currency,
        computedAt: new Date(),
      },
    });
  return { upserted: 1 };
}

// ---------------------------------------------------------------------------
// Internal helpers (small, pure).
// ---------------------------------------------------------------------------

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** UTC yyyy-mm-dd for a Date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Exclusive end day for an inclusive `to` date: `to + 1 day` so a
 * `< end` predicate includes the whole `to` day.
 */
function isoDayExclusiveEnd(d: Date): string {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return isoDay(next);
}

function firstOfMonthIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

function firstOfNextMonthIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const nextY = m === 11 ? y + 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  return `${nextY}-${pad2(nextM + 1)}-01`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * postgres-js / Drizzle `execute` returns either a bare array (Drizzle's
 * postgres-js driver) or a `{ rows }` wrapper depending on the path. Normalise.
 */
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: unknown[] } | null;
  return (r?.rows ?? []) as T[];
}
