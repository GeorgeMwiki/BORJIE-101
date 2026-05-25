/**
 * Adaptive Training schema.
 *
 * Drizzle definitions mirroring `0070_adaptive_training.sql`. Replaces the
 * rigid classroom/course model with admin-driven, Mr. Mwikila-generated
 * training paths that are delivered inline via the chat widget and tracked
 * through the existing Wave-11 BKT mastery table.
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const trainingPaths = pgTable(
  'training_paths',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    topic: text('topic').notNull(),
    audience: text('audience').notNull(),
    language: text('language').notNull().default('en'),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    conceptIds: jsonb('concept_ids').notNull().default([]),
    summary: text('summary'),
    generatedBy: text('generated_by').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('idx_training_paths_tenant').on(t.tenantId, t.createdAt),
    topicAudienceIdx: uniqueIndex('uniq_training_paths_topic_audience').on(
      t.tenantId,
      t.topic,
      t.audience
    ),
  })
);

export const trainingPathSteps = pgTable(
  'training_path_steps',
  {
    id: text('id').primaryKey(),
    pathId: text('path_id')
      .notNull()
      .references(() => trainingPaths.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    conceptId: text('concept_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    content: jsonb('content').notNull().default({}),
    masteryThreshold: doublePrecision('mastery_threshold').notNull().default(0.8),
    estimatedMinutes: integer('estimated_minutes').notNull().default(5),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pathOrderIdx: index('idx_training_path_steps_path_order').on(
      t.pathId,
      t.orderIndex
    ),
  })
);

export const trainingAssignments = pgTable(
  'training_assignments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pathId: text('path_id')
      .notNull()
      .references(() => trainingPaths.id, { onDelete: 'cascade' }),
    assigneeUserId: text('assignee_user_id').notNull(),
    assignedBy: text('assigned_by').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    progressPct: doublePrecision('progress_pct').notNull().default(0),
    lastDeliveredStep: text('last_delivered_step'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    assigneeIdx: index('idx_training_assignments_assignee').on(
      t.tenantId,
      t.assigneeUserId,
      t.status
    ),
    statusIdx: index('idx_training_assignments_status').on(
      t.tenantId,
      t.status,
      t.assignedAt
    ),
    uniquePathAssignee: uniqueIndex('uniq_training_assignments_path_assignee').on(
      t.tenantId,
      t.pathId,
      t.assigneeUserId
    ),
  })
);

export const trainingDeliveryEvents = pgTable(
  'training_delivery_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => trainingAssignments.id, { onDelete: 'cascade' }),
    stepId: text('step_id'),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    assignmentIdx: index('idx_training_delivery_events_assignment').on(
      t.assignmentId,
      t.occurredAt
    ),
    typeIdx: index('idx_training_delivery_events_type').on(
      t.tenantId,
      t.eventType,
      t.occurredAt
    ),
  })
);
