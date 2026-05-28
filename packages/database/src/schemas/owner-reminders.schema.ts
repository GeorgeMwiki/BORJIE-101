/**
 * Owner Reminders — Wave OWNER-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0089_owner_reminders_and_tabs.sql
 *   - services/api-gateway/src/routes/owner/reminders.hono.ts
 *   - services/api-gateway/src/workers/reminders-dispatch.worker.ts
 *
 * One Drizzle table:
 *
 *   reminders — owner-scheduled events. The reminders-dispatch worker
 *               polls `trigger_at <= now() AND status='scheduled'` every
 *               30s, dispatches via the existing notifications-service
 *               providers, flips status to 'sent' (or 'failed' on
 *               provider error), and records dispatched_at +
 *               dispatch_error. idempotency_key (REQUIRED + UNIQUE per
 *               tenant) makes the dispatch loop safe under restart +
 *               partial failure.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy. FORCE
 * RLS is enabled on the table per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

export const REMINDER_CHANNELS = ['email', 'sms', 'slack'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_STATUSES = [
  'scheduled',
  'sent',
  'failed',
  'cancelled',
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant scope. Bound by RLS via `app.tenant_id` GUC. */
    tenantId: text('tenant_id').notNull(),
    /** Supabase user id of the owner who created the reminder. */
    ownerId: text('owner_id').notNull(),
    /** Short title — becomes email subject / SMS / Slack prefix. */
    title: text('title').notNull(),
    /** Long-form body. Dispatcher renders to HTML for email, plain for
     *  SMS / Slack. */
    body: text('body').notNull(),
    /** Wall-clock at which the dispatcher should fire. */
    triggerAt: timestamp('trigger_at', { withTimezone: true }).notNull(),
    /** Delivery channel chosen at creation. Email is the default. */
    channel: text('channel').notNull().default('email'),
    /** Lifecycle. scheduled → sent | failed | cancelled. */
    status: text('status').notNull().default('scheduled'),
    /** Free-form structured context (e.g. document_id, deep link). */
    payload: jsonb('payload').notNull().default({}),
    /** REQUIRED. Worker dispatches at most once per
     *  (tenant_id, idempotency_key) pair. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    dispatchError: text('dispatch_error'),
    /**
     * Chat-as-OS bidirectional parity: which path produced this row
     * (chat | form | agent_apply | api | legacy | unknown). See
     * migration 0101 + helper `provenanceColumn()`.
     */
    provenance: provenanceColumn(),
  },
  (t) => ({
    dispatchQueueIdx: index('idx_reminders_dispatch_queue').on(t.triggerAt),
    ownerCreatedIdx: index('idx_reminders_owner_created').on(
      t.tenantId,
      t.ownerId,
      t.createdAt,
    ),
    idemUniq: uniqueIndex('reminders_idem_uniq').on(
      t.tenantId,
      t.idempotencyKey,
    ),
  }),
);

export type ReminderRow = typeof reminders.$inferSelect;
export type ReminderInsert = typeof reminders.$inferInsert;
