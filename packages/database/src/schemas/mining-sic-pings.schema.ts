/**
 * Mining SIC (Short Interval Control) pings — supervisor periodic check-ins.
 *
 * Backs the owner-cockpit "SIC ping queue" widget. Each ping is a one-shot
 * status emission from a supervisor on a hot shift; the queue surfaces
 * the most recent N pings per tenant so the owner can spot a stall, a
 * safety concern, or an equipment-down anywhere in the portfolio without
 * waiting for the daily shift report.
 *
 * Tenant-scoped via RLS (migration 0082) on `app.tenant_id`. RLS is
 * FORCE-enabled so the policy applies to table owners too.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const miningSicPings = pgTable(
  'mining_sic_pings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    siteId: text('site_id'),
    /** Supervisor who emitted the ping. */
    pingedByUserId: text('pinged_by_user_id').notNull(),
    /** Ping timestamp. */
    pingedAt: timestamp('pinged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** ok|delay|stop|safety_concern|equipment_down|other. */
    status: text('status').notNull().default('ok'),
    /** Swahili-first free-text note. */
    noteSw: text('note_sw'),
    /** Optional KPI snapshot at the moment of the ping (tonnes, headcount, ...). */
    kpiSnapshot: jsonb('kpi_snapshot').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPingedAtIdx: index('idx_mining_sic_pings_tenant_pinged_at').on(
      t.tenantId,
      t.pingedAt,
    ),
    tenantSiteIdx: index('idx_mining_sic_pings_tenant_site').on(
      t.tenantId,
      t.siteId,
      t.pingedAt,
    ),
    tenantStatusIdx: index('idx_mining_sic_pings_tenant_status').on(
      t.tenantId,
      t.status,
      t.pingedAt,
    ),
  }),
);

export type MiningSicPing = typeof miningSicPings.$inferSelect;
export type NewMiningSicPing = typeof miningSicPings.$inferInsert;
