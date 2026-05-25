/**
 * Event Outbox Schema - BORJIE Platform
 * 
 * Implements the Transactional Outbox Pattern for reliable event publishing.
 * Events are written to the outbox within the same transaction as the business operation,
 * then published asynchronously by a separate process.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

// Enums
export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'published',
  'failed',
  'dead_letter',
]);

export const eventPriorityEnum = pgEnum('event_priority', [
  'low',
  'normal',
  'high',
  'critical',
]);

// Event Outbox Table
export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    
    // Event identification
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    
    // Event data
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').default({}),
    
    // Ordering and versioning
    sequenceNumber: integer('sequence_number').notNull(),
    version: integer('version').notNull().default(1),
    
    // Processing status
    status: outboxStatusEnum('status').notNull().default('pending'),
    priority: eventPriorityEnum('priority').notNull().default('normal'),
    
    // Retry tracking
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(5),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    
    // Processing timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    
    // Tracing
    traceId: text('trace_id'),
    spanId: text('span_id'),
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),
    
    // Locking for concurrent processing
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('event_outbox_tenant_idx').on(table.tenantId),
    statusIdx: index('event_outbox_status_idx').on(table.status),
    statusCreatedIdx: index('event_outbox_status_created_idx').on(table.status, table.createdAt),
    aggregateIdx: index('event_outbox_aggregate_idx').on(table.aggregateType, table.aggregateId),
    eventTypeIdx: index('event_outbox_event_type_idx').on(table.eventType),
    nextRetryIdx: index('event_outbox_next_retry_idx').on(table.nextRetryAt),
    priorityStatusIdx: index('event_outbox_priority_status_idx').on(table.priority, table.status),
    correlationIdx: index('event_outbox_correlation_idx').on(table.correlationId),
    lockIdx: index('event_outbox_lock_idx').on(table.lockedBy, table.lockExpiresAt),
    // Wave-4 D9: payouts-worker (and any future per-event-type worker)
    // picks rows via WHERE event_type = ? AND status = 'pending'
    // ORDER BY created_at. The picker is the worker's hot loop —
    // a composite (event_type, status, created_at) lets it index-walk
    // a tiny slice instead of intersecting eventTypeIdx with statusIdx.
    eventTypeStatusCreatedIdx: index('event_outbox_event_type_status_created_idx').on(
      table.eventType,
      table.status,
      table.createdAt,
    ),
  })
);

// Dead Letter Queue for failed events
export const eventDeadLetter = pgTable(
  'event_dead_letter',
  {
    id: text('id').primaryKey(),
    originalEventId: text('original_event_id').notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').default({}),
    
    failureReason: text('failure_reason').notNull(),
    failureDetails: jsonb('failure_details'),
    retryHistory: jsonb('retry_history').default([]),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    originalCreatedAt: timestamp('original_created_at', { withTimezone: true }).notNull(),
    
    // Manual resolution
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    resolutionNotes: text('resolution_notes'),
  },
  (table) => ({
    tenantIdx: index('event_dead_letter_tenant_idx').on(table.tenantId),
    eventTypeIdx: index('event_dead_letter_event_type_idx').on(table.eventType),
    aggregateIdx: index('event_dead_letter_aggregate_idx').on(table.aggregateType, table.aggregateId),
    createdAtIdx: index('event_dead_letter_created_at_idx').on(table.createdAt),
    unresolvedIdx: index('event_dead_letter_unresolved_idx').on(table.resolvedAt),
  })
);

// Event Subscriptions for pattern-based routing
export const eventSubscriptions = pgTable(
  'event_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    
    subscriberId: text('subscriber_id').notNull(),
    subscriberName: text('subscriber_name').notNull(),
    
    // Pattern matching
    eventPattern: text('event_pattern').notNull(),
    aggregatePattern: text('aggregate_pattern'),
    
    // Delivery configuration
    endpoint: text('endpoint').notNull(),
    endpointType: text('endpoint_type').notNull().default('http'),
    headers: jsonb('headers').default({}),
    
    // Status
    isActive: boolean('is_active').notNull().default(true),
    
    // Rate limiting
    maxEventsPerSecond: integer('max_events_per_second').default(100),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('event_subscriptions_tenant_idx').on(table.tenantId),
    subscriberIdx: index('event_subscriptions_subscriber_idx').on(table.subscriberId),
    patternIdx: index('event_subscriptions_pattern_idx').on(table.eventPattern),
    activeIdx: index('event_subscriptions_active_idx').on(table.isActive),
  })
);

// Relations
export const eventOutboxRelations = relations(eventOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [eventOutbox.tenantId],
    references: [tenants.id],
  }),
}));

export const eventDeadLetterRelations = relations(eventDeadLetter, ({ one }) => ({
  tenant: one(tenants, {
    fields: [eventDeadLetter.tenantId],
    references: [tenants.id],
  }),
}));

export const eventSubscriptionsRelations = relations(eventSubscriptions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [eventSubscriptions.tenantId],
    references: [tenants.id],
  }),
}));

// Type exports
export type EventOutboxRecord = typeof eventOutbox.$inferSelect;
export type NewEventOutboxRecord = typeof eventOutbox.$inferInsert;

export type EventDeadLetterRecord = typeof eventDeadLetter.$inferSelect;
export type NewEventDeadLetterRecord = typeof eventDeadLetter.$inferInsert;

export type EventSubscriptionRecord = typeof eventSubscriptions.$inferSelect;
export type NewEventSubscriptionRecord = typeof eventSubscriptions.$inferInsert;
