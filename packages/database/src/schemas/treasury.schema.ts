/**
 * Treasury — cash balances (Timescale hypertable), FX rates, mineral prices,
 * costs and forecasts.
 *
 * Per DATA_MODEL.md §3.3-§3.4. `cash_balances` is a Timescale hypertable
 * keyed by `recorded_at`. `fx_rates` and `mineral_prices` are append-only
 * snapshots (no Timescale hypertable in v1 — small write volume).
 *
 * NOTE: `cash_balances` does NOT have a synthetic `id` primary key —
 * Timescale prefers composite keys for hypertable rows. Drizzle still
 * needs a primary key in the metadata so we use a composite of
 * (tenant_id, account_id, recorded_at).
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  date,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import { companies, bankAccounts } from './companies.schema.js';
import { sites } from './sites.schema.js';

// ============================================================================
// cash_balances — Timescale hypertable (time column = recorded_at)
// ============================================================================

export const cashBalances = pgTable(
  'cash_balances',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    balanceTzs: numeric('balance_tzs', { precision: 18, scale: 2 }).notNull(),
    /** ISO-4217 native currency snapshot; balance_tzs is the converted TZS view. */
    balanceNative: numeric('balance_native', { precision: 18, scale: 2 }),
    nativeCurrency: text('native_currency').notNull().default('TZS'),
    /** mpesa|bank_statement|cash_count|manual|reconciliation_run. */
    source: text('source').notNull().default('manual'),
    attributes: jsonb('attributes').notNull().default({}),
  },
  (t) => ({
    pk: primaryKey({
      name: 'cash_balances_pk',
      columns: [t.tenantId, t.accountId, t.recordedAt],
    }),
    tenantTsIdx: index('cash_balances_tenant_ts_idx').on(t.tenantId, t.recordedAt),
    accountTsIdx: index('cash_balances_account_ts_idx').on(t.accountId, t.recordedAt),
  }),
);

// ============================================================================
// fx_rates — append-only FX snapshots
// ============================================================================

export const fxRates = pgTable(
  'fx_rates',
  {
    id: text('id').primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    /** Currency pair, e.g. TZS_USD, TZS_EUR. */
    pair: text('pair').notNull(),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    /** BoT|LBMA|LME|Fastmarkets|... */
    source: text('source').notNull().default('BoT'),
  },
  (t) => ({
    pairTsIdx: index('fx_rates_pair_ts_idx').on(t.pair, t.ts),
  }),
);

// ============================================================================
// mineral_prices — public commodity ticker snapshots
// ============================================================================

export const mineralPrices = pgTable(
  'mineral_prices',
  {
    id: text('id').primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    mineral: text('mineral').notNull(),
    /** USD/oz|USD/t|USD/kg|USD/dmtu|TZS/g|... */
    unit: text('unit').notNull(),
    price: numeric('price', { precision: 14, scale: 4 }).notNull(),
    source: text('source').notNull().default('LBMA'),
  },
  (t) => ({
    mineralTsIdx: index('mineral_prices_mineral_ts_idx').on(t.mineral, t.ts),
  }),
);

// ============================================================================
// costs — tenant-scoped cost ledger
// ============================================================================

export const costs = pgTable(
  'costs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /**
     * wages|fuel|food|water|equipment|repairs|land|transport|processing|
     * security|admin|debt|advance|royalty|inspection|levy|other.
     */
    category: text('category').notNull(),
    amountTzs: numeric('amount_tzs', { precision: 18, scale: 2 }).notNull(),
    /** ISO-4217. */
    amountCurrency: text('amount_currency').notNull().default('TZS'),
    amountNative: numeric('amount_native', { precision: 18, scale: 2 }),
    /** actual|forecast|committed|unpaid|disputed|hidden|document_blocked|idle_time. */
    state: text('state').notNull().default('actual'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    evidenceId: text('evidence_id'),
    attributes: jsonb('attributes').notNull().default({}),
  },
  (t) => ({
    tenantIdx: index('costs_tenant_idx').on(t.tenantId),
    siteIdx: index('costs_site_idx').on(t.siteId),
    categoryIdx: index('costs_category_idx').on(t.tenantId, t.category),
    stateIdx: index('costs_state_idx').on(t.tenantId, t.state),
    tsIdx: index('costs_tenant_ts_idx').on(t.tenantId, t.ts),
  }),
);

// ============================================================================
// forecasts — model outputs (production, cash, prices, ...)
// ============================================================================

export const forecasts = pgTable(
  'forecasts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** site|company|licence|tenant. */
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id'),
    /**
     * production_t|cash_runway_d|fuel_days|excavator_failure_p|
     * mineral_price|fx|recoverable_g|demurrage_risk_p|demand|npv|break_even.
     */
    metric: text('metric').notNull(),
    horizonDays: integer('horizon_days').notNull(),
    low: numeric('low', { precision: 20, scale: 4 }),
    mid: numeric('mid', { precision: 20, scale: 4 }),
    high: numeric('high', { precision: 20, scale: 4 }),
    basis: text('basis'),
    modelVersion: text('model_version'),
    asOfDate: date('as_of_date').notNull().defaultNow(),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('forecasts_tenant_idx').on(t.tenantId),
    scopeIdx: index('forecasts_scope_idx').on(t.tenantId, t.scopeKind, t.scopeId),
    metricIdx: index('forecasts_metric_idx').on(t.tenantId, t.metric),
  }),
);

export type CashBalance = typeof cashBalances.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type MineralPrice = typeof mineralPrices.$inferSelect;
export type Cost = typeof costs.$inferSelect;
export type Forecast = typeof forecasts.$inferSelect;
