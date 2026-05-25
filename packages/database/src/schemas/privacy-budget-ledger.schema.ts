/**
 * Per-tenant privacy-budget ledger (migration 0130).
 *
 * Backs the K6.2 `PrivacyBudgetComposerService` — a unified ledger that
 * tracks (ε, δ) spend across all DP-aggregator calls per tenant in a
 * 30-day rolling window. Sits BESIDE the existing
 * `platform_privacy_budget` (singleton, platform-wide) so the composer
 * can prevent an attacker from alternating between per-tenant and
 * platform surfaces to compound their effective spend (parity-gap G2).
 *
 * Cap-by-tier rather than cap-by-actor — the tier-derived total is
 * looked up at write-time so changing a tenant's plan does not require
 * a backfill.
 *
 * Two tables:
 *   privacy_budget_ledger
 *     One row per (tenant_id, window_start). Holds cumulative spend
 *     for the 30-day window starting at `window_start`.
 *   privacy_budget_spend
 *     Append-only audit log; one row per `recordSpend()` call so
 *     auditors can reconstruct which queries consumed the budget.
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────
// Per-tenant ledger row.
// ─────────────────────────────────────────────────────────────────────

export const privacyBudgetLedger = pgTable(
  'privacy_budget_ledger',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Tier at the time the ledger row was opened. Frozen for the window. */
    tier: text('tier').notNull(),
    /** ISO timestamp of the 30-day window start (rolling). */
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    /** Hard cap for the window. Derived from `tier`. */
    totalEpsilon: doublePrecision('total_epsilon').notNull(),
    totalDelta: doublePrecision('total_delta').notNull(),
    /** Running totals. Mutated atomically inside `recordSpend()`. */
    spentEpsilon: doublePrecision('spent_epsilon').notNull().default(0),
    spentDelta: doublePrecision('spent_delta').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqTenantWindow: uniqueIndex('uniq_privacy_budget_tenant_window').on(
      t.tenantId,
      t.windowStart,
    ),
    byTenant: index('idx_privacy_budget_ledger_tenant').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// Append-only audit log.
// ─────────────────────────────────────────────────────────────────────

export const privacyBudgetSpend = pgTable(
  'privacy_budget_spend',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    queryId: text('query_id').notNull(),
    epsilon: doublePrecision('epsilon').notNull(),
    delta: doublePrecision('delta').notNull(),
    /** Window the spend was applied to (FK-like reference to ledger.windowStart). */
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    spentAt: timestamp('spent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byTenant: index('idx_privacy_budget_spend_tenant').on(t.tenantId),
    bySpentAt: index('idx_privacy_budget_spend_spent_at').on(t.spentAt),
  }),
);
