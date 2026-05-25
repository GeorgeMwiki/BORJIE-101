/**
 * Kernel action audit — every step transition the executor makes.
 *
 * Append-only. One row per (goal_id, step_id, decision) transition;
 * the executor records `running` → `done|failed|awaiting-approval|
 * skipped|unknown-tool`. Powers the operator-side replay view.
 *
 * Migration 0123 — paired with `kernel_goals`.
 */
import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const kernelActionAudit = pgTable(
  'kernel_action_audit',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    goalId: text('goal_id').notNull(),
    stepId: text('step_id').notNull(),
    /** Tool name; null for informational steps. */
    toolName: text('tool_name'),
    /** 'running'|'done'|'failed'|'awaiting-approval'|'skipped'|'unknown-tool' */
    decision: text('decision').notNull(),
    payloadHash: text('payload_hash').notNull(),
    outcome: text('outcome'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    latencyMs: doublePrecision('latency_ms'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index('idx_kernel_action_audit_tenant_time').on(
      t.tenantId,
      t.capturedAt.desc(),
    ),
    goalIdx: index('idx_kernel_action_audit_goal').on(t.goalId),
    stepIdx: index('idx_kernel_action_audit_step').on(t.stepId),
  }),
);
