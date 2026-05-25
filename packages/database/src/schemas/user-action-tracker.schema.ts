/**
 * user_action_tracker (migration 0183) — per-(tenant, user, action)
 * lifetime counters backing the progressive-disclosure mastery layer.
 *
 * Why a separate table rather than rolling action counts into the
 * audit log? Audit events are append-only and partition-friendly but
 * expensive to query for "how many times has this user used feature X
 * across all time?". The mastery tracker reads this table on every
 * UI render where a `<MasteryGate>` mounts — it must be O(1) per
 * (tenant, user, action).
 *
 * Composite primary key on (tenant_id, user_id, action_id) guarantees
 * upsert semantics with a single index lookup. `first_seen` is set
 * once on insert; `last_seen` is bumped on every upsert.
 *
 * Row-level security:
 *   - SELECT  — tenant_id matches app.current_tenant_id GUC
 *   - INSERT  — same predicate via WITH CHECK
 *   - UPDATE  — same predicate, applied to old AND new rows
 *
 * The migration (0183_user_action_tracker.sql) wires the RLS policies;
 * Drizzle does not emit them. This file describes the column shape so
 * downstream repositories get a typed interface.
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

export const userActionTracker = pgTable(
  'user_action_tracker',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    actionId: text('action_id').notNull(),
    actionCount: bigint('action_count', { mode: 'number' })
      .notNull()
      .default(0),
    firstSeen: timestamp('first_seen', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId, t.actionId] }),
    // Mastery lookups read every row for one (tenant, user) tuple; the
    // PK already covers that prefix so an explicit index would be
    // redundant. We DO add a (tenant_id, last_seen) index for the
    // "recently active users" cohort queries the analytics layer runs.
    tenantLastSeenIdx: index('idx_user_action_tracker_tenant_last_seen').on(
      t.tenantId,
      t.lastSeen.desc(),
    ),
    actionCountCheck: check(
      'user_action_tracker_action_count_chk',
      sql`${t.actionCount} >= 0`,
    ),
  }),
);

export type UserActionTrackerRow = typeof userActionTracker.$inferSelect;
export type NewUserActionTrackerRow = typeof userActionTracker.$inferInsert;
