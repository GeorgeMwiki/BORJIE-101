/**
 * set_point_state — the closed-loop set-point regulation memory (Wave-C C3
 * WIN-4: perceive → act → re-observe → did-it-recover?).
 *
 * Companion to:
 *   - packages/database/src/migrations/0330_set_point_state.sql
 *   - services/api-gateway/src/composition/md-commitments/set-point-store.ts
 *     (createDrizzleSetPointStateStore — the SetPointStateStore port impl)
 *
 * One row per (tenant_id, drive_id). The EstateMind RECONCILE sweep's
 * delta-evaluator (reconcile-engine.ts: evaluateSetPointDelta) reads the prior
 * tick's breach severity + worsening streak from here, computes the
 * continuity-of-care verdict, and writes the next state back — so the loop can
 * SUPPRESS a redundant nudge (improving) or AUTO-PROMOTE the corrective rung
 * (worsening past the streak floor).
 *
 * A DEDICATED table — NOT situational_model_entities — because that table's
 * `kind` is a CLOSED enum AND it is the salience-arena snapshot the kernel
 * reads each turn; a synthetic set-point entity would fail validation and
 * pollute the arena (see the note in estate-mind-wiring.ts).
 *
 * Tenant-scoped: FORCE RLS on the canonical `app.current_tenant_id` GUC per
 * CLAUDE.md hard rule (migration 0330 installs the tenant-isolation +
 * service-role-bypass policies; the out-of-band sweep writes via the
 * service-role path).
 */

import {
  pgTable,
  text,
  numeric,
  integer,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const setPointState = pgTable(
  'set_point_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The standing drive this memory regulates (a DriveId slug). */
    driveId: text('drive_id').notNull(),
    /** Last tick's [0,1] breach severity (the delta-evaluator compares to it). */
    priorBreachSeverity: numeric('prior_breach_severity').notNull().default('0'),
    /** Worsening-streak length that drives the auto-promote (floor 3). */
    consecutiveWorseningTicks: integer('consecutive_worsening_ticks')
      .notNull()
      .default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantDriveUniq: uniqueIndex('set_point_state_tenant_drive_uniq').on(
      table.tenantId,
      table.driveId,
    ),
  }),
);

export type SetPointStateRow = typeof setPointState.$inferSelect;
export type NewSetPointStateRow = typeof setPointState.$inferInsert;
