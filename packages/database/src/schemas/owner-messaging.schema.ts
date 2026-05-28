/**
 * Owner-to-Owner Messaging — Wave OWNER-MESSAGING.
 *
 * Companion to:
 *   - packages/database/src/migrations/0107_owner_messaging.sql
 *   - services/api-gateway/src/routes/owner/messaging/threads.hono.ts
 *
 * Direct messaging between owners. Recipients are looked up via NIDA
 * (national ID), TIN (tax identifier), or BRELA registration number.
 * The chat brain exposes `owner.messaging.send_to`, `unread_count`,
 * `thread_list` so the LLM can read + send on the owner's behalf.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const OWNER_THREAD_STATUSES = [
  'open',
  'closed',
  'archived',
] as const;
export type OwnerThreadStatus = (typeof OWNER_THREAD_STATUSES)[number];

export const OWNER_PARTICIPANT_ROLES = [
  'initiator',
  'recipient',
  'observer',
] as const;
export type OwnerParticipantRole = (typeof OWNER_PARTICIPANT_ROLES)[number];

export const ownerThreads = pgTable(
  'owner_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    createdById: uuid('created_by_id').notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantActivityIdx: index('owner_threads_tenant_activity').on(
      table.tenantId,
      table.lastActivityAt,
    ),
  }),
);

export type OwnerThread = typeof ownerThreads.$inferSelect;
export type NewOwnerThread = typeof ownerThreads.$inferInsert;

export const ownerThreadParticipants = pgTable(
  'owner_thread_participants',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => ownerThreads.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    role: text('role').notNull().default('observer'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.ownerId] }),
    ownerIdx: index('owner_thread_participants_owner').on(
      table.ownerId,
      table.joinedAt,
    ),
  }),
);

export type OwnerThreadParticipant =
  typeof ownerThreadParticipants.$inferSelect;
export type NewOwnerThreadParticipant =
  typeof ownerThreadParticipants.$inferInsert;

export const ownerMessages = pgTable(
  'owner_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => ownerThreads.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    bodyMd: text('body_md').notNull(),
    attachments: jsonb('attachments').notNull().default([]),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readBy: jsonb('read_by').notNull().default({}),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
  },
  (table) => ({
    threadSentIdx: index('owner_messages_thread_sent').on(
      table.threadId,
      table.sentAt,
    ),
    tenantSentIdx: index('owner_messages_tenant_sent').on(
      table.tenantId,
      table.sentAt,
    ),
  }),
);

export type OwnerMessage = typeof ownerMessages.$inferSelect;
export type NewOwnerMessage = typeof ownerMessages.$inferInsert;
