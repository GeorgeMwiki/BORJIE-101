/**
 * Tenant budget envelopes — period-bound USD ceiling per tenant.
 *
 * Mirrors LITFIN's `tenant_budget_envelopes`. One row per (tenant_id,
 * period) where `period` is the UTC month boundary the envelope covers
 * (period_start..period_end). Closes the routing-control gap identified
 * in `.planning/parity-litfin/04-sensors-routing.md` section 7 — gives
 * an admin a single knob to throttle a non-paying tenant down to
 * Sonnet/Haiku without a deploy.
 *
 * The companion table `sensor_call_log` (`./sensor-call-log.schema.ts`)
 * is the append-only log that debits `consumed_usd_micro`. Together
 * they form the routing control plane.
 *
 * Costs are BIGINT microdollars (1 USD = 1_000_000) — never floats.
 */

import {
  pgTable,
  text,
  bigint,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const tenantBudgetEnvelopes = pgTable(
  'tenant_budget_envelopes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Inclusive start of the budget period (typically UTC month start). */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    /** Exclusive end (UTC month start of the next month). */
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    /** Microdollar ceiling for the period. Hard cap when enforced. */
    budgetUsdMicro: bigint('budget_usd_micro', { mode: 'number' })
      .notNull()
      .default(0),
    /** Microdollars debited so far this period (cached for fast reads). */
    consumedUsdMicro: bigint('consumed_usd_micro', { mode: 'number' })
      .notNull()
      .default(0),
    /** 0..100. Triggers alert webhook when utilisation crosses threshold. */
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    /** When true the router refuses calls that would breach the ceiling. */
    hardCapEnforced: boolean('hard_cap_enforced').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPeriodIdx: uniqueIndex('uq_tenant_budget_envelopes_tenant_period').on(
      t.tenantId,
      t.periodStart,
    ),
    tenantIdx: index('idx_tenant_budget_envelopes_tenant').on(t.tenantId),
  }),
);
