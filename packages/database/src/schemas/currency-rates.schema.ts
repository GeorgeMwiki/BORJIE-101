/**
 * Currency rates (migration 0117).
 *
 * FX-rate snapshot table: one row per ISO-4217 currency code, holding
 * the conversion factor to USD ("1 unit of <code> = rateToUsd USD").
 * Backs the platform-overview HQ KPI router's monthly-revenue
 * aggregator, which sums per-currency `payments.amount` slices and
 * normalises each to USD before reporting a single platform-wide
 * number.
 *
 * Seeded with manual defaults for USD / TZS / KES (see migration 0117);
 * a future job can refresh `rateToUsd` from a real FX feed (fixer.io,
 * ECB, etc.) and stamp `asOf` + `source` accordingly. The asOf index
 * keeps "most recent N rates" lookups cheap.
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const currencyRates = pgTable(
  'currency_rates',
  {
    code: text('code').primaryKey(), // ISO-4217: 'TZS', 'KES', 'USD', 'EUR', ...
    rateToUsd: doublePrecision('rate_to_usd').notNull(), // 1 unit of <code> = rateToUsd USD
    asOf: timestamp('as_of', { withTimezone: true }).notNull().defaultNow(),
    source: text('source'), // 'manual' | 'fixer-io' | 'ecb' | ...
  },
  (t) => ({
    asOfIdx: index('idx_currency_rates_as_of').on(t.asOf),
  }),
);
