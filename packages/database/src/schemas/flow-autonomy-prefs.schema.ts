/**
 * flow_autonomy_prefs — flow-keyed autonomy posture (migration 0308).
 *
 * Each created flow / workflow carries its own sticky `auto | gated`
 * posture, keyed on (tenant_id, flow_id). This is the per-flow upgrade
 * over the single global `tenant_autonomy_caps` switch
 * (Docs/research/ORCHESTRATION_SPEC.md §Autonomy-gating model
 * onFlowCreation).
 *
 * Lifecycle:
 *   - Flow CREATION inserts a row with posture='gated',
 *     confirmation_state='pending' — the fail-safe USER-GATED default.
 *     The pending state surfaces the one-time auto-vs-gated confirmation
 *     (the flow track-record is shown at the moment of asking, for
 *     trust-calibration).
 *   - Setting AUTO flips posture='auto', confirmation_state='confirmed',
 *     and stamps promoted_at. The workflow-engine then SKIPS the per-run
 *     human-approval step for that flow.
 *
 * HARD RULE (additive only): AUTO widens the autonomy POLICY, never the
 * rails. The inviolable rails (policy-gate / four-eye / sovereign /
 * kill_switch / money-path) STILL gate per action regardless of posture
 * — rail-gate ALWAYS wins; this row can only ADD gating.
 *
 * Companion to:
 *   - packages/database/src/migrations/0308_flow_autonomy_prefs.sql
 *   - packages/workflow-engine/src/autonomy/flow-autonomy-port.ts
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy; FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  bigint,
  timestamp,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const flowAutonomyPrefs = pgTable(
  'flow_autonomy_prefs',
  {
    tenantId: text('tenant_id').notNull(),
    flowId: text('flow_id').notNull(),
    /** 'gated' (USER-GATED default) | 'auto'. */
    posture: text('posture').notNull().default('gated'),
    /** 'pending' (creation-time confirmation unanswered) | 'confirmed'. */
    confirmationState: text('confirmation_state').notNull().default('pending'),
    /** Advisory risk ceiling for AUTO; rails still gate HIGH-risk. */
    riskCeiling: text('risk_ceiling'),
    /** Optional minor-unit money ceiling above which AUTO is suppressed. */
    amountThreshold: bigint('amount_threshold', { mode: 'number' }),
    createdBy: text('created_by').notNull(),
    /** Set when the flow is flipped to AUTO (earned-promotion stamp). */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.flowId] }),
    tenantIdx: index('flow_autonomy_prefs_tenant_idx').on(table.tenantId),
    tenantConfirmationIdx: index(
      'flow_autonomy_prefs_tenant_confirmation_idx',
    ).on(table.tenantId, table.confirmationState),
    postureCheck: check(
      'flow_autonomy_prefs_posture_chk',
      sql`${table.posture} IN ('gated', 'auto')`,
    ),
    confirmationCheck: check(
      'flow_autonomy_prefs_confirmation_chk',
      sql`${table.confirmationState} IN ('pending', 'confirmed')`,
    ),
    amountCheck: check(
      'flow_autonomy_prefs_amount_chk',
      sql`${table.amountThreshold} IS NULL OR ${table.amountThreshold} >= 0`,
    ),
  }),
);

export type FlowAutonomyPrefRow = typeof flowAutonomyPrefs.$inferSelect;
export type NewFlowAutonomyPrefRow = typeof flowAutonomyPrefs.$inferInsert;
