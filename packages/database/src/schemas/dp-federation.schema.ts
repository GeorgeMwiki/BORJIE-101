/**
 * DP-federation persistence (Wave SELFIMPROVE).
 *
 * Companion to Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 * Drizzle types for the dp_charges table created by migration
 * 0047_selfimprove_omni_p2.sql.
 *
 *   - dpCharges → one row per DP operation; per-operation accounting
 *                 ground truth. The strategic-layer's
 *                 `epsilon_budgets` table sums these rows for the
 *                 owner-facing privacy ledger.
 *
 * Tenant-scoped with RLS via canonical `app.tenant_id` GUC policy.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  numeric,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// dp_charges
// ============================================================================

export const dpCharges = pgTable(
  'dp_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** First day of the budget period (typically quarter). */
    periodStart: date('period_start').notNull(),
    /** epsilon spent on this operation. */
    epsilonDelta: numeric('epsilon_delta', { precision: 20, scale: 12 }).notNull(),
    /** dp-mean | dp-sum | dp-count | dp-gradient | ... */
    operation: text('operation').notNull(),
    opId: text('op_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantPeriodIdx: index('idx_dp_charges_tenant_period').on(
      table.tenantId,
      table.periodStart,
    ),
    tenantRecordedIdx: index('idx_dp_charges_tenant_recorded').on(
      table.tenantId,
      table.recordedAt,
    ),
    tenantOpUnique: uniqueIndex('uniq_dp_charges_tenant_op').on(
      table.tenantId,
      table.opId,
    ),
  }),
);

export type DpChargeRow = typeof dpCharges.$inferSelect;
export type NewDpChargeRow = typeof dpCharges.$inferInsert;
