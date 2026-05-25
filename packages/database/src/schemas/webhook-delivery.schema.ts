/**
 * Webhook Delivery Schema — Wave 8 outbound webhook retry + DLQ.
 *
 * See `services/api-gateway/src/workers/webhook-retry-worker.ts` and
 * `packages/database/src/migrations/0031_webhook_retry_dlq.sql`.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const webhookDeliveryAttempts = pgTable(
  'webhook_delivery_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').notNull(),
    targetUrl: text('target_url').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull(),
    statusCode: integer('status_code'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_webhook_attempts_tenant').on(t.tenantId),
    deliveryIdx: index('idx_webhook_attempts_delivery').on(t.deliveryId),
  })
);

export const webhookDeadLetters = pgTable(
  'webhook_dead_letters',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').notNull(),
    targetUrl: text('target_url').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    totalAttempts: integer('total_attempts').notNull(),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    replayedBy: text('replayed_by'),
    replayDeliveryId: text('replay_delivery_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_webhook_dlq_tenant').on(t.tenantId),
  })
);

export type WebhookDeliveryAttempt = typeof webhookDeliveryAttempts.$inferSelect;
export type NewWebhookDeliveryAttempt = typeof webhookDeliveryAttempts.$inferInsert;
export type WebhookDeadLetter = typeof webhookDeadLetters.$inferSelect;
export type NewWebhookDeadLetter = typeof webhookDeadLetters.$inferInsert;
