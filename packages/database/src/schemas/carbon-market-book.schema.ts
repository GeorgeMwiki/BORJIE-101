/**
 * carbon_market_book_entries — Drizzle schema (migration 0170).
 *
 * Persistent backing for the `BookEntryRepository` port declared in
 * `packages/carbon-market/src/types.ts`. The trading-desk
 * (`packages/carbon-market/src/desk/trading-desk.ts`) writes one row
 * per booked spot/forward; the persistent variant of the repository
 * (`createCarbonMarketBookService` in this package) reads + mutates
 * those rows for mark-to-market, settlement, and cancellation.
 *
 * Pricing convention:
 *   - `price_per_unit_cents` stores USD price per tCO2e in cents
 *     (BIGINT) so mark-to-market sums never drift from binary-float
 *     rounding. The carbon-market `BookEntry` exposes
 *     `priceUsdPerTonne` as a number; the adapter multiplies by 100
 *     on write and divides by 100 on read.
 *   - `currency` stays CHAR(3) for future cross-currency books even
 *     though the desk currently normalises every line to USD.
 *
 * Status state machine:
 *   - 'open'      — booked, awaiting settlement.
 *   - 'settled'   — settlement_date set, no further state changes.
 *   - 'cancelled' — voided pre-settlement; metadata.cancellationReason
 *                   carries the human-readable explanation.
 *
 * Multi-tenant isolation:
 *   - `tenant_id` mandatory; the adapter filters every read by tenant
 *     so a compromised entry_id can't be replayed cross-tenant.
 *   - Pairs cleanly with RLS migration 0155.
 */

import {
  pgTable,
  text,
  numeric,
  bigint,
  jsonb,
  timestamp,
  index,
  char,
} from 'drizzle-orm/pg-core';

export const carbonMarketBookEntries = pgTable(
  'carbon_market_book_entries',
  {
    /** Trading-desk-issued id (`BE-<base36-ts>-<counter>` or any unique TEXT). */
    entryId: text('entry_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    counterparty: text('counterparty').notNull(),
    /** Market symbol — e.g. 'CIX-NBS-2024', 'EUA-DEC26'. */
    symbol: text('symbol').notNull(),
    /** Side — pinned to 'buy' | 'sell' at the SQL CHECK constraint. */
    side: text('side').notNull(),
    /** tCO2e. NUMERIC(20,6) supports fractional ITMO transfers. */
    qty: numeric('qty', { precision: 20, scale: 6 }).notNull(),
    /** USD price per tCO2e in cents. BIGINT to avoid float drift. */
    pricePerUnitCents: bigint('price_per_unit_cents', { mode: 'bigint' }).notNull(),
    /** ISO-4217 — always 'USD' for current desk; widened for the future. */
    currency: char('currency', { length: 3 }).notNull(),
    /** Forward tenor — NULL for spot. */
    tenor: text('tenor'),
    /** Wall-clock trade time (server side). */
    tradeDate: timestamp('trade_date', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when status transitions to 'settled'. */
    settlementDate: timestamp('settlement_date', { withTimezone: true }),
    /** Pinned at SQL CHECK: 'open' | 'settled' | 'cancelled'. */
    status: text('status').notNull(),
    /** Open extension point — cancellation reason, custodian refs, etc. */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Status dashboard scan. */
    tenantStatusIdx: index('carbon_market_book_entries_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    /** Per-symbol mark-to-market timeline. */
    tenantSymbolIdx: index('carbon_market_book_entries_tenant_symbol_idx').on(
      t.tenantId,
      t.symbol,
      t.tradeDate,
    ),
  }),
);

export type CarbonMarketBookEntryRow = typeof carbonMarketBookEntries.$inferSelect;
export type NewCarbonMarketBookEntryRow = typeof carbonMarketBookEntries.$inferInsert;
