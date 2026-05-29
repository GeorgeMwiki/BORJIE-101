/**
 * Help requests — field-workforce R5 closure.
 *
 * Backing migration: `0126_help_requests.sql`.
 *
 * One row per "Naomba msaada" tap from the workforce-mobile hero card.
 * Surfaces to managers via /api/v1/field/workforce/help-requests and
 * fans out to the owner cockpit as a workforce.shift_event so the
 * cockpit pulses when a worker raises a hand.
 *
 * Tenant scope: RLS FORCE per CLAUDE.md hard rule. Handlers MUST NOT
 * double-filter — the api-gateway database middleware sets
 * `app.current_tenant_id` on every authenticated request.
 *
 * Lifecycle: open → ack → resolved | cancelled.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const helpRequests = pgTable(
  'help_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workerUserId: uuid('worker_user_id').notNull(),
    /** Optional — the task the worker was stuck on. */
    taskId: uuid('task_id'),
    /** Optional — derived from worker's open shift when available. */
    siteId: uuid('site_id'),
    /** UI locale at submit time. `sw` (default) or `en`. */
    locale: text('locale').notNull().default('sw'),
    /** Optional free-form note from the worker. */
    messageText: text('message_text'),
    /** open | ack | resolved | cancelled */
    status: text('status').notNull().default('open'),
    ackByUserId: uuid('ack_by_user_id'),
    ackAt: timestamp('ack_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Pointer into ai_audit_chain for forensic replay. */
    auditHashId: uuid('audit_hash_id'),
    /** Chat-as-OS bidirectional parity provenance. */
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('help_requests_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    tenantWorkerIdx: index('help_requests_tenant_worker_idx').on(
      t.tenantId,
      t.workerUserId,
      t.createdAt,
    ),
    tenantTaskIdx: index('help_requests_tenant_task_idx').on(
      t.tenantId,
      t.taskId,
    ),
  }),
);

export type HelpRequest = typeof helpRequests.$inferSelect;
export type HelpRequestInsert = typeof helpRequests.$inferInsert;
