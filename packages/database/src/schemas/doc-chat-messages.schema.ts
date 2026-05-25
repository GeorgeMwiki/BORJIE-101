/**
 * Document Chat Messages Schema (NEW 15)
 *
 * Each message row stores the user's question or the AI's answer. Answers
 * MUST carry a non-empty `citations` array — the document-chat service
 * enforces this and refuses to persist an assistant message without it.
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
import { docChatSessions } from './doc-chat-sessions.schema.js';

export const docChatRoleEnum = pgEnum('doc_chat_role', [
  'user',
  'assistant',
  'system',
]);

export const docChatMessages = pgTable(
  'doc_chat_messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => docChatSessions.id, { onDelete: 'cascade' }),

    role: docChatRoleEnum('role').notNull(),
    authorUserId: text('author_user_id'),
    content: text('content').notNull(),

    // Retrieval + citation metadata:
    // [{documentId, chunkIndex, quote, score, page?}]
    citations: jsonb('citations').notNull().default([]),
    retrievedChunkIds: jsonb('retrieved_chunk_ids').notNull().default([]),
    model: text('model'),
    tokensUsed: jsonb('tokens_used'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('doc_chat_messages_tenant_idx').on(table.tenantId),
    sessionIdx: index('doc_chat_messages_session_idx').on(table.sessionId),
    roleIdx: index('doc_chat_messages_role_idx').on(table.role),
  })
);

export type DocChatMessage = typeof docChatMessages.$inferSelect;
export type NewDocChatMessage = typeof docChatMessages.$inferInsert;
