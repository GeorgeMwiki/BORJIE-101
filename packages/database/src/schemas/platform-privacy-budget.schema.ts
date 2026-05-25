/**
 * Platform privacy-budget ledger (migration 0116).
 *
 * Persists the `PlatformBudgetLedger` port from
 * `@borjie/graph-privacy` so cohort DP-aggregator budget
 * consumption survives api-gateway restarts. Single-row pattern: one
 * `'singleton'` row in `platform_privacy_budget` holds the totals and
 * cumulative spend; every successful `reserve()` appends an
 * audit row to `platform_privacy_budget_reservations`.
 *
 * The Drizzle schema mirrors migration 0116 — keep the two in lock-step.
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────
// Singleton budget row — one row, primary-keyed `'singleton'`.
// ─────────────────────────────────────────────────────────────────────

export const platformPrivacyBudget = pgTable('platform_privacy_budget', {
  id: text('id').primaryKey(),
  totalEpsilon: doublePrecision('total_epsilon').notNull(),
  spentEpsilon: doublePrecision('spent_epsilon').notNull().default(0),
  totalDelta: doublePrecision('total_delta').notNull(),
  spentDelta: doublePrecision('spent_delta').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────
// Reservation audit log — one row per successful reserve() call.
// ─────────────────────────────────────────────────────────────────────

export const platformPrivacyBudgetReservations = pgTable(
  'platform_privacy_budget_reservations',
  {
    id: text('id').primaryKey(),
    epsilon: doublePrecision('epsilon').notNull(),
    delta: doublePrecision('delta').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    reservedAtIdx: index('idx_platform_privacy_budget_reservations_reserved_at').on(
      t.reservedAt,
    ),
  }),
);
