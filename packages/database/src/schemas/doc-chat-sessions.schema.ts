/**
 * Document Chat Sessions Schema (NEW 15)
 *
 * A session groups a conversation about one or more documents. Can be
 * 1:1 (single doc) or a group chat (multi-doc, multi-participant).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const docChatScopeEnum = pgEnum('doc_chat_scope', [
  'single_document',
  'multi_document',
  'group_chat',
]);

export const docChatSessions = pgTable(
  'doc_chat_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    scope: docChatScopeEnum('scope').notNull().default('single_document'),
    title: text('title'),
    // References to documents indexed for this session.
    documentIds: jsonb('document_ids').notNull().default([]),
    // Array of user IDs participating in a group chat.
    participants: jsonb('participants').notNull().default([]),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('doc_chat_sessions_tenant_idx').on(table.tenantId),
    createdByIdx: index('doc_chat_sessions_created_by_idx').on(table.createdBy),
  })
);

export type DocChatSession = typeof docChatSessions.$inferSelect;
export type NewDocChatSession = typeof docChatSessions.$inferInsert;
