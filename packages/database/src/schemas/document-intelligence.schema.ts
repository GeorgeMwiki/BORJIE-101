/**
 * Document Intelligence schema — companion to migration 0083.
 *
 * Two new tables backing the "documents as alive entities" wave:
 *
 *   - `documentIntelligenceSessions` — pairs a user with one or more
 *     uploaded documents being explored via the brain. Sessions can
 *     carry an initial prompt + a title; status moves active -> archived.
 *
 *   - `documentCorpusLinks` — joins a `document_uploads.id` to its
 *     `intelligence_corpus_chunks.id` rows so retrieval can be scoped
 *     to a specific document (vs the global mining ground-truth corpus).
 *
 * Both tables are tenant-scoped via the canonical
 * `current_setting('app.tenant_id', true)` GUC RLS pattern (FORCE-enabled
 * in migration 0083). Per the Borjie hard rule, the per-tenant corpus
 * NEVER stores `tenant_id = NULL` — that is reserved for the global
 * mining ground-truth corpus.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// document_intelligence_sessions — user-bound chat sessions with N documents
// ============================================================================

export const documentIntelligenceSessions = pgTable(
  'document_intelligence_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** User who opened the session. */
    userId: text('user_id').notNull(),
    /** Optional human-friendly title; defaults to the first doc name. */
    title: text('title'),
    /** Array of document_uploads.id (text) that this session covers. */
    documentIds: jsonb('document_ids').notNull().default([]),
    /** Optional first-turn prompt the user typed when opening the session. */
    initialPrompt: text('initial_prompt'),
    /** active|archived. */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserCreatedIdx: index('idx_dis_tenant_user_created').on(
      t.tenantId,
      t.userId,
      t.createdAt,
    ),
    tenantLastMessageIdx: index('idx_dis_tenant_last_message').on(
      t.tenantId,
      t.lastMessageAt,
    ),
  }),
);

export type DocumentIntelligenceSession =
  typeof documentIntelligenceSessions.$inferSelect;
export type NewDocumentIntelligenceSession =
  typeof documentIntelligenceSessions.$inferInsert;

// ============================================================================
// document_corpus_links — join document_uploads -> intelligence_corpus_chunks
// ============================================================================

export const documentCorpusLinks = pgTable(
  'document_corpus_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Soft-FK to document_uploads.id (text PK). */
    documentId: text('document_id').notNull(),
    /** Soft-FK to intelligence_corpus_chunks.id. */
    chunkId: text('chunk_id').notNull(),
    /** Zero-based chunk order within the document. */
    chunkIndex: integer('chunk_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    documentChunkUniq: uniqueIndex('dcl_document_chunk_uniq').on(
      t.documentId,
      t.chunkId,
    ),
    tenantDocumentIdx: index('idx_dcl_tenant_document').on(
      t.tenantId,
      t.documentId,
      t.chunkIndex,
    ),
    tenantChunkIdx: index('idx_dcl_tenant_chunk').on(t.tenantId, t.chunkId),
  }),
);

export type DocumentCorpusLink = typeof documentCorpusLinks.$inferSelect;
export type NewDocumentCorpusLink = typeof documentCorpusLinks.$inferInsert;
