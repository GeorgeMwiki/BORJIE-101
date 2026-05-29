/**
 * Company-Brain ingestion tables — Wave COMPANY-BRAIN (C-1).
 *
 * Companion to:
 *   - packages/database/src/migrations/0140_corpus_doc_uploads.sql
 *   - services/api-gateway/src/services/brain-ingestion/*
 *   - services/api-gateway/src/routes/owner/brain.hono.ts
 *
 * One row per file/text/audio/photo the owner feeds the brain. The
 * status field is the lone mutable column (drives the live progress
 * meter); everything else is write-once. Memory durability promise in
 * Docs/OPS/MEMORY_DURABILITY.md — never DELETE.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const SOURCE_KINDS = [
  'csv',
  'xlsx',
  'pdf',
  'photo',
  'audio',
  'text',
  'json',
  'email',
  'webpage',
] as const;

export type CorpusSourceKind = (typeof SOURCE_KINDS)[number];

export const UPLOAD_STATUSES = [
  'pending',
  'parsing',
  'chunking',
  'embedded',
  'indexed',
  'failed',
  'redacted',
] as const;

export type CorpusUploadStatus = (typeof UPLOAD_STATUSES)[number];

export const corpusDocUploads = pgTable(
  'corpus_doc_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    uploadedByUserId: text('uploaded_by_user_id').notNull(),
    sourceKind: text('source_kind').$type<CorpusSourceKind>().notNull(),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageUrl: text('storage_url').notNull(),
    status: text('status').$type<CorpusUploadStatus>().notNull().default('pending'),
    chunksCount: integer('chunks_count').notNull().default(0),
    entitiesExtracted: integer('entities_extracted').notNull().default(0),
    errorMessage: text('error_message'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    tenantUploadedIdx: index('corpus_doc_uploads_tenant_uploaded_idx').on(
      t.tenantId,
      t.uploadedAt,
    ),
    tenantStatusIdx: index('corpus_doc_uploads_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    userIdx: index('corpus_doc_uploads_user_idx').on(
      t.tenantId,
      t.uploadedByUserId,
    ),
  }),
);

export type CorpusDocUpload = typeof corpusDocUploads.$inferSelect;
export type NewCorpusDocUpload = typeof corpusDocUploads.$inferInsert;

export const corpusDocSummaries = pgTable(
  'corpus_doc_summaries',
  {
    uploadId: uuid('upload_id')
      .primaryKey()
      .references(() => corpusDocUploads.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    summaryMd: text('summary_md').notNull(),
    summaryEn: text('summary_en').notNull(),
    summarySw: text('summary_sw').notNull(),
    keyFacts: jsonb('key_facts').notNull().default([]),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('corpus_doc_summaries_tenant_idx').on(t.tenantId),
  }),
);

export type CorpusDocSummary = typeof corpusDocSummaries.$inferSelect;
export type NewCorpusDocSummary = typeof corpusDocSummaries.$inferInsert;
