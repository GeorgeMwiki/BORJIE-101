/**
 * Intelligence corpus chunks — pgvector-backed bootstrap brain.
 *
 * Per DATA_MODEL.md §4. Holds the chunked + embedded text of every
 * primary-source document Borjie ships: TZ mining regulations, mineral
 * dossiers, geological reference material, plus tenant-uploaded
 * documents.
 *
 * `tenant_id IS NULL` ⇒ global Borjie corpus (read-only for every
 * tenant). `tenant_id IS NOT NULL` ⇒ that tenant's private chunks.
 * RLS policy allows SELECT when tenant_id matches current GUC OR
 * tenant_id IS NULL.
 *
 * Embedding column: `vector(1024)` (Cohere embed-v3 multilingual) —
 * added by the migration via raw SQL because Drizzle has no first-class
 * pgvector type. Drizzle exposes it as a typed `customType` column.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * Custom drizzle column wrapping pgvector. Stored as `vector(1024)` in
 * Postgres; serialised as `[0.1, 0.2, ...]` string at the wire. The
 * migration ensures the `vector` extension is created.
 */
const vector1024 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    const stripped = value.replace(/^\[|\]$/g, '');
    return stripped ? stripped.split(',').map(Number) : [];
  },
});

export const intelligenceCorpusChunks = pgTable(
  'intelligence_corpus_chunks',
  {
    id: text('id').primaryKey(),
    /** NULL = global Borjie corpus shared across every tenant. */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** e.g. 'research/01_TZ_MINING_REGULATION_2025_2026.md'. */
    sourceFile: text('source_file').notNull(),
    section: text('section'),
    page: integer('page'),
    text: text('text').notNull(),
    embedding: vector1024('embedding'),
    /** Live citation URL (gov gazette, agency portal, etc.). */
    url: text('url'),
    /** ISO-639-1: en|sw|fr|zh|pt. */
    language: text('language').notNull().default('en'),
    /** {mineral, jurisdiction, doc_type, ...} for filtered retrieval. */
    metadata: jsonb('metadata').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When a newer chunk supersedes this one, point to it for time-travel. */
    supersededById: text('superseded_by_id'),
  },
  (t) => ({
    tenantIdx: index('intelligence_corpus_chunks_tenant_idx').on(t.tenantId),
    sourceIdx: index('intelligence_corpus_chunks_source_section_idx').on(
      t.sourceFile,
      t.section,
    ),
    langIdx: index('intelligence_corpus_chunks_lang_idx').on(t.language),
    supersededIdx: index('intelligence_corpus_chunks_superseded_idx').on(
      t.supersededById,
    ),
  }),
);

export type IntelligenceCorpusChunk = typeof intelligenceCorpusChunks.$inferSelect;
export type NewIntelligenceCorpusChunk = typeof intelligenceCorpusChunks.$inferInsert;
