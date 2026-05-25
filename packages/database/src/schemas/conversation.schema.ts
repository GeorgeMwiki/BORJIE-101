/**
 * Conversation schemas — threads, messages, tool calls, handoff packets.
 *
 * These tables back the Brain's Thread Store. The `InMemoryThreadStore` in
 * `@borjie/ai-copilot` is the dev default; production replaces it with a
 * Postgres-backed implementation over these tables.
 *
 * Core design principles (from Cognition's "share context, share traces"):
 *  - Append-only. No updates to events.
 *  - Every event carries a visibility label.
 *  - Handoff packets are stored verbatim so downstream personae and auditors
 *    can replay the decision trail.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// Enums
// ============================================================================

export const threadStatusEnum = pgEnum('thread_status', [
  'open',
  'resolved',
  'archived',
]);

export const threadEventKindEnum = pgEnum('thread_event_kind', [
  'user_message',
  'persona_message',
  'tool_call',
  'tool_result',
  'handoff_out',
  'handoff_in',
  'review_requested',
  'review_decision',
  'system_note',
]);

export const visibilityScopeEnum = pgEnum('visibility_scope', [
  'private',
  'team',
  'management',
  'public',
]);

// ============================================================================
// Threads
// ============================================================================

export const threads = pgTable(
  'threads',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    initiatingUserId: text('initiating_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    primaryPersonaId: text('primary_persona_id').notNull(),

    /** Optional team binding (for Junior threads). */
    teamId: text('team_id'),
    /** Optional employee binding (for Coworker threads). */
    employeeId: text('employee_id'),

    title: text('title').notNull(),
    status: threadStatusEnum('status').notNull().default('open'),

    /** Aggregates kept fresh on each event append (write-optimized). */
    eventCount: integer('event_count').notNull().default(0),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('threads_tenant_idx').on(table.tenantId),
    userIdx: index('threads_user_idx').on(table.initiatingUserId),
    personaIdx: index('threads_persona_idx').on(
      table.tenantId,
      table.primaryPersonaId
    ),
    teamIdx: index('threads_team_idx').on(table.teamId),
    employeeIdx: index('threads_employee_idx').on(table.employeeId),
    statusIdx: index('threads_status_idx').on(table.tenantId, table.status),
  })
);

// ============================================================================
// Thread Events — the canonical append-only trace
// ============================================================================

export const threadEvents = pgTable(
  'thread_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),

    kind: threadEventKindEnum('kind').notNull(),
    actorId: text('actor_id').notNull(),

    // Visibility
    visibilityScope: visibilityScopeEnum('visibility_scope').notNull(),
    visibilityAuthorActorId: text('visibility_author_actor_id').notNull(),
    visibilityInitiatingUserId: text('visibility_initiating_user_id'),
    visibilityTeamId: text('visibility_team_id'),
    visibilityRationale: text('visibility_rationale'),

    parentEventId: text('parent_event_id'),

    /** Event-kind-specific payload. Keep shape stable per `kind`. */
    payload: jsonb('payload').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('thread_events_tenant_idx').on(table.tenantId),
    threadIdx: index('thread_events_thread_idx').on(table.threadId),
    kindIdx: index('thread_events_kind_idx').on(table.tenantId, table.kind),
    actorIdx: index('thread_events_actor_idx').on(table.actorId),
    createdIdx: index('thread_events_created_idx').on(table.createdAt),
    parentIdx: index('thread_events_parent_idx').on(table.parentEventId),
  })
);

// ============================================================================
// Handoff Packets — stored separately for auditability & replay
// ============================================================================

export const handoffPackets = pgTable(
  'handoff_packets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => threadEvents.id, { onDelete: 'cascade' }),

    sourcePersonaId: text('source_persona_id').notNull(),
    targetPersonaId: text('target_persona_id').notNull(),

    objective: text('objective').notNull(),
    outputFormat: text('output_format').notNull(),
    contextSummary: text('context_summary').notNull(),
    latestUserMessage: text('latest_user_message'),

    relevantEntities: jsonb('relevant_entities').notNull().default([]),
    priorDecisions: jsonb('prior_decisions').notNull().default([]),
    constraints: jsonb('constraints').notNull().default([]),
    allowedTools: text('allowed_tools').array().default([]),

    visibilityScope: visibilityScopeEnum('visibility_scope').notNull(),
    tokensSoFar: integer('tokens_so_far').notNull().default(0),
    tokenBudget: integer('token_budget').notNull(),

    accepted: boolean('accepted').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('handoff_packets_tenant_idx').on(table.tenantId),
    threadIdx: index('handoff_packets_thread_idx').on(table.threadId),
    sourceIdx: index('handoff_packets_source_idx').on(table.sourcePersonaId),
    targetIdx: index('handoff_packets_target_idx').on(table.targetPersonaId),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const threadsRelations = relations(threads, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [threads.tenantId],
    references: [tenants.id],
  }),
  initiatingUser: one(users, {
    fields: [threads.initiatingUserId],
    references: [users.id],
  }),
  events: many(threadEvents),
  handoffs: many(handoffPackets),
}));

export const threadEventsRelations = relations(threadEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [threadEvents.tenantId],
    references: [tenants.id],
  }),
  thread: one(threads, {
    fields: [threadEvents.threadId],
    references: [threads.id],
  }),
}));

export const handoffPacketsRelations = relations(handoffPackets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [handoffPackets.tenantId],
    references: [tenants.id],
  }),
  thread: one(threads, {
    fields: [handoffPackets.threadId],
    references: [threads.id],
  }),
  event: one(threadEvents, {
    fields: [handoffPackets.eventId],
    references: [threadEvents.id],
  }),
}));
