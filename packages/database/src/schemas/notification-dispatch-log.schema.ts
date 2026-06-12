/**
 * Notification Dispatch Log — the per-recipient delivery ledger.
 *
 * This table is the spine of the notification rails: the announcement
 * fan-out worker and the in-app push port ENQUEUE `pending` rows; the
 * dispatch drain worker (`services/notification-dispatch/dispatcher-worker.ts`)
 * claims them (`pending` → `sending`), calls the email/SMS/push provider, and
 * marks the outcome (`sent` / `failed`) with retry/backoff + DLQ columns.
 *
 * Column contract is the EXACT union of the live writers — never guess:
 *   - INSERT: workforce-deps-wiring.ts (app_push), announcement-fanout.worker.ts
 *     (broadcast), workers/lease-expiry-alert-cron.ts (alert). All share the
 *     same 14-column INSERT with ON CONFLICT (tenant_id, idempotency_key).
 *   - UPDATE: services/notification-dispatch/dispatcher-worker.ts adds
 *     `provider`, `provider_error_code`, `next_retry_at`, `dead_lettered_at`,
 *     `dead_letter_reason`.
 *
 * The `notifications` BFF route does `SELECT *` and returns rows, so this
 * Drizzle object MUST declare every physical column.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS policy +
 * a service-role bypass for the out-of-band drain/fan-out cron (CLAUDE.md
 * hard rule). FORCE RLS is enabled at the DB level.
 *
 * Companion files:
 *   - packages/database/src/migrations/0348_notification_dispatch_log.sql
 *   - services/api-gateway/src/routes/notifications.ts (the BFF reader)
 *   - services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts
 *   - services/api-gateway/src/composition/org-loop/workforce-deps-wiring.ts
 */

import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const NOTIFICATION_DELIVERY_STATUSES = [
  'pending',
  'sending',
  'sent',
  'failed',
] as const;
export type NotificationDeliveryStatus =
  (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const notificationDispatchLog = pgTable(
  'notification_dispatch_log',
  {
    /** Writer-minted string id (`ndl_<uuid>`). Text, not uuid. */
    id: text('id').primaryKey(),
    /** Tenant scope. Bound by RLS via `app.current_tenant_id` GUC. */
    tenantId: text('tenant_id').notNull(),
    /** In-app push recipient (workforce). Mutually exclusive-ish with customerId. */
    userId: text('user_id'),
    /** Customer recipient (e.g. lease-expiry alerts). */
    customerId: text('customer_id'),
    /** 'app_push' | 'email' | 'sms' | ... */
    channel: text('channel').notNull(),
    /** Resolved recipient handle (email/E.164/`user:<id>`/`unaddressed`). */
    recipientAddress: text('recipient_address').notNull(),
    /** Template key driving render (e.g. `platform.announcement.broadcast`). */
    templateKey: text('template_key').notNull(),
    /** Render locale ('en' | 'sw'). */
    locale: text('locale').notNull().default('en'),
    /** Serialized render payload. */
    payload: jsonb('payload').notNull().default({}),
    /** Correlation id tying related dispatches together. */
    correlationId: text('correlation_id'),
    /** Per-(tenant) idempotency key — ON CONFLICT dedupe. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** Send attempts so far. */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** pending | sending | sent | failed. */
    deliveryStatus: text('delivery_status').notNull().default('pending'),
    /** Provider that handled the send (set on attempt). */
    provider: text('provider'),
    /** Upstream provider message id (set on success). */
    providerMessageId: text('provider_message_id'),
    /** Provider error code (set on failure). */
    providerErrorCode: text('provider_error_code'),
    /** Provider error message (set on failure). */
    providerErrorMessage: text('provider_error_message'),
    /** Wall-clock of the most recent send attempt. */
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** Backoff target for the next retry (NULL when terminal). */
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    /** Set when the row is dead-lettered (terminal failure). */
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    /** Why the row was dead-lettered. */
    deadLetterReason: text('dead_letter_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // ON CONFLICT (tenant_id, idempotency_key) DO NOTHING — the enqueue dedupe.
    tenantIdemKey: uniqueIndex('notification_dispatch_log_tenant_idem_key').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    // The drain worker's hot scan: pending rows for a tenant by recency.
    tenantStatusIdx: index('notification_dispatch_log_tenant_status_idx').on(
      table.tenantId,
      table.deliveryStatus,
    ),
  }),
);

export type NotificationDispatchLogRow =
  typeof notificationDispatchLog.$inferSelect;
export type NotificationDispatchLogInsert =
  typeof notificationDispatchLog.$inferInsert;
