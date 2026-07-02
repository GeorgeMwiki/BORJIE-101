/**
 * Benchmark + market reference tables — Wave TIER-1 POWERS REALITY.
 *
 * Three GLOBAL (non-tenant-scoped) market-reference tables the risk- and
 * opportunity-scanner resolvers read as ground truth. Every row is shared
 * reference data readable by every tenant; writes are service-role only (a
 * tenant writing a market fix would poison every other tenant's scanner).
 *
 * Companion to:
 *   - packages/database/src/migrations/0371_benchmark_market_reference.sql
 *   - services/api-gateway/src/services/risk-scanner/scanner.ts
 *   - services/api-gateway/src/services/opportunity-scanner/resolver.ts
 *
 * The peer_cohort_aggregates / external_benchmarks tables live in
 * peer-cohort-benchmarks.schema.ts (migration 0095) — this file adds ONLY the
 * three market tables 0371 creates.
 */

import {
  pgTable,
  text,
  numeric,
  boolean,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// bot_gold_windows — Bank of Tanzania domestic gold-purchase windows.
// The opportunity FX slice reads `is_open` WHERE NOW() BETWEEN starts_at/ends_at.
// ============================================================================

export const botGoldWindows = pgTable(
  'bot_gold_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    windowName: text('window_name').notNull(),
    isOpen: boolean('is_open').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    windowSpanIdx: index('idx_bgw_window_span').on(t.startsAt, t.endsAt),
  }),
);

export type BotGoldWindow = typeof botGoldWindows.$inferSelect;
export type NewBotGoldWindow = typeof botGoldWindows.$inferInsert;

// ============================================================================
// lbma_fix_summary — pre-rolled LBMA fix 30d summary. The risk market slice
// reads (current_fix - mean_30d) / std_30d as a sigma delta, newest per asset.
// ============================================================================

export const lbmaFixSummary = pgTable(
  'lbma_fix_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asset: text('asset').notNull(),
    currentFix: numeric('current_fix', { precision: 20, scale: 4 }).notNull(),
    mean30d: numeric('mean_30d', { precision: 20, scale: 4 }).notNull(),
    std30d: numeric('std_30d', { precision: 20, scale: 4 }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text('notes'),
  },
  (t) => ({
    assetCapturedIdx: index('idx_lfs_asset_captured').on(
      t.asset,
      t.capturedAt,
    ),
  }),
);

export type LbmaFixSummary = typeof lbmaFixSummary.$inferSelect;
export type NewLbmaFixSummary = typeof lbmaFixSummary.$inferInsert;

// ============================================================================
// fx_rates_intraday — intraday FX snapshot. The risk market slice reads
// (intraday_high - intraday_low) / intraday_low * 100 as a volatility %.
// ============================================================================

export const fxRatesIntraday = pgTable(
  'fx_rates_intraday',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pair: text('pair').notNull(),
    intradayOpen: numeric('intraday_open', { precision: 20, scale: 6 })
      .notNull(),
    intradayHigh: numeric('intraday_high', { precision: 20, scale: 6 })
      .notNull(),
    intradayLow: numeric('intraday_low', { precision: 20, scale: 6 })
      .notNull(),
    intradayClose: numeric('intraday_close', { precision: 20, scale: 6 })
      .notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text('notes'),
  },
  (t) => ({
    pairCapturedIdx: index('idx_fri_pair_captured').on(
      t.pair,
      t.capturedAt,
    ),
  }),
);

export type FxRateIntraday = typeof fxRatesIntraday.$inferSelect;
export type NewFxRateIntraday = typeof fxRatesIntraday.$inferInsert;
