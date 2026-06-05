/**
 * Analytics warehouses — owner-portal Analytics surface read-models.
 *
 * Three append-mostly warehouse tables back the owner-portal Analytics
 * pages that previously returned `X-Backend-Status: degraded`:
 *
 *   - `analytics_usage_daily`     (migration 0175) — feature-usage counts
 *     per (tenant, day, dimension), populated from `audit_events`. Backs
 *     `GET /api/v1/analytics/usage`.
 *   - `analytics_growth_monthly`  (migration 0176) — operating-output +
 *     revenue trend per (tenant, month), populated from the mining domain
 *     (sites → production → sales → ledger). Backs
 *     `GET /api/v1/analytics/growth`.
 *   - `analytics_export_templates` (migration 0177) — saved export
 *     definitions per tenant. Backs `GET /api/v1/analytics/exports/templates`.
 *
 * Money model (CLAUDE.md hard rule)
 * ---------------------------------
 * Every money amount is an INTEGER MINOR UNIT — never float / numeric.
 * `revenue_minor_units` / `royalty_minor_units` are `bigint(..., 'number')`
 * (mirrors payments-ledger.schema.ts) so an accumulating monthly revenue
 * roll-up cannot overflow INTEGER. `currency` is stored alongside every
 * money column (ISO-4217) so the renderer threads it into
 * `formatCurrency(amount, code)` — NEVER a hardcoded TZS/USD.
 *
 * RLS (CLAUDE.md hard rule)
 * -------------------------
 * Every table is tenant-scoped via FORCE row-level security on the
 * `app.current_tenant_id` GUC. The SQL policies are created in the
 * companion migrations (0175/0176/0177), mirroring 0160/0171's correct
 * GUC. No app-code double-filtering — RLS enforces isolation; the repos
 * additionally predicate on `tenant_id` as belt-and-braces.
 *
 * NB: indexes are declared in SQL (the migrations) rather than in these
 * `pgTable` builders, mirroring payments-ledger.schema.ts — keeps the
 * builders index-free and avoids non-portable inferred-type leaks across
 * the package boundary.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  date,
  jsonb,
} from 'drizzle-orm/pg-core';

// ============================================================================
// analytics_usage_daily — feature-usage counts per (tenant, day, dimension)
// ============================================================================
//
// One row per (tenant_id, day, dimension). `dimension` is the audit
// category/action bucket (e.g. 'AUTH', 'PAYMENT', 'mining.production') and
// `count` is the number of matching `audit_events` for that bucket on that
// UTC day. The aggregator UPSERTs on (tenant_id, day, dimension) so a
// re-run is idempotent (no double-counting).

export const analyticsUsageDaily = pgTable('analytics_usage_daily', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  /** UTC calendar day this bucket covers. */
  day: date('day').notNull(),
  /** Usage dimension — audit category or action bucket. */
  dimension: text('dimension').notNull(),
  /** Count of feature-usage events in this bucket. */
  count: integer('count').notNull().default(0),
  /** Free-form roll-up extras (e.g. distinct-actor count). */
  attributes: jsonb('attributes').notNull().default({}),
  computedAt: timestamp('computed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalyticsUsageDaily = typeof analyticsUsageDaily.$inferSelect;
export type NewAnalyticsUsageDaily = typeof analyticsUsageDaily.$inferInsert;

// ============================================================================
// analytics_growth_monthly — operating-output + revenue trend per month
// ============================================================================
//
// One row per (tenant_id, period). `period` is the first day of the month
// (UTC). Derived from the mining domain:
//   - active_sites   ← COUNT(sites) active in the month
//   - production_kg  ← SUM(production_records.mass_kg) in the month
//   - sales_count    ← COUNT(sales) in the month
//   - revenue_minor_units ← SUM(ledger CREDIT lines) settled in the month
//   - royalty_minor_units ← SUM(ledger royalty lines) in the month
// Money columns carry `currency` (ISO-4217) — never hardcoded. The
// aggregator UPSERTs on (tenant_id, period) for idempotent re-runs.

export const analyticsGrowthMonthly = pgTable('analytics_growth_monthly', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  /** First UTC day of the month this row aggregates. */
  period: date('period').notNull(),
  /** Distinct active sites in the period. */
  activeSites: integer('active_sites').notNull().default(0),
  /** Summed production mass (kg) in the period — COUNT/measure, not money. */
  productionKg: bigint('production_kg', { mode: 'number' }).notNull().default(0),
  /** Number of sale transactions in the period. */
  salesCount: integer('sales_count').notNull().default(0),
  /** Settled revenue in the period — BIGINT minor units (integer minor units). */
  revenueMinorUnits: bigint('revenue_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
  /** Royalty accrued in the period — BIGINT minor units. */
  royaltyMinorUnits: bigint('royalty_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
  /** ISO-4217 code for the money columns. Threaded into formatCurrency. */
  currency: text('currency').notNull(),
  /** Free-form roll-up extras. */
  attributes: jsonb('attributes').notNull().default({}),
  computedAt: timestamp('computed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalyticsGrowthMonthly = typeof analyticsGrowthMonthly.$inferSelect;
export type NewAnalyticsGrowthMonthly =
  typeof analyticsGrowthMonthly.$inferInsert;

// ============================================================================
// analytics_export_templates — saved export definitions per tenant
// ============================================================================
//
// A tenant-authored, reusable export definition (e.g. "monthly royalty
// return CSV"). `kind` is the export family (csv|xlsx|pdf|json); `schema`
// is the column/filter spec the export engine consumes. NO money columns —
// this is configuration metadata only.

export const analyticsExportTemplates = pgTable('analytics_export_templates', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  /** Export family: csv|xlsx|pdf|json. */
  kind: text('kind').notNull().default('csv'),
  /** Column/filter spec the export engine consumes. */
  schema: jsonb('schema').notNull().default({}),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalyticsExportTemplate =
  typeof analyticsExportTemplates.$inferSelect;
export type NewAnalyticsExportTemplate =
  typeof analyticsExportTemplates.$inferInsert;
