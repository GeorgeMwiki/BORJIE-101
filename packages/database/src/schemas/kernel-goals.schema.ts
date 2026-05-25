/**
 * Kernel goals — persistent objectives the brain works on across days.
 *
 * One row per Goal. Step decomposition rides as a JSON array on
 * `steps` so the kernel-side port can rewrite the list immutably
 * without a separate child table. Step counts (stepsTotal / stepsDone)
 * mirror the JSON for cheap dashboard queries.
 *
 * Migration 0123 — paired with `kernel_action_audit`.
 */
import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const kernelGoals = pgTable(
  'kernel_goals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    threadId: text('thread_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** 'active'|'paused'|'blocked'|'completed'|'abandoned' */
    status: text('status').notNull(),
    /** 'low'|'medium'|'high'|'critical' */
    priority: text('priority').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Array of GoalStep JSON. */
    steps: jsonb('steps').notNull().default([]),
    stepsTotal: integer('steps_total').notNull().default(0),
    stepsDone: integer('steps_done').notNull().default(0),
    /** Wake-loop stall hint — short reason captured at the moment the
     *  stall-detection sweep flagged the goal. Migration 0131. */
    stallReason: text('stall_reason'),
    /** Timestamp of the most recent transition to status = 'stalled'.
     *  Migration 0131. */
    stalledAt: timestamp('stalled_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserStatusIdx: index('idx_kernel_goals_tenant_user_status').on(
      t.tenantId,
      t.userId,
      t.status,
      t.createdAt.desc(),
    ),
    threadIdx: index('idx_kernel_goals_thread').on(t.threadId),
    stalledAtIdx: index('idx_kernel_goals_stalled_at').on(t.stalledAt),
  }),
);
