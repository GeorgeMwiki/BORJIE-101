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

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  customType,
  index,
  uniqueIndex,
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
    /**
     * EXPRESSION unique index on
     *   (COALESCE(tenant_id,''), source_file, COALESCE(section,''))
     * — the chunk's natural identity. NULL tenant_id (global corpus) and
     * NULL section fold to '' so they dedupe deterministically, and the
     * tenant is part of the key so two tenants' same-named files never
     * collide (KI-05 / KI-06 / KI-13). Created by migration
     * `0311_corpus_chunk_unique_upsert_key.sql`; the consolidation worker's
     * `ON CONFLICT (COALESCE(tenant_id,''), source_file, COALESCE(section,''))`
     * upsert targets this exact expression. Declared here so schema↔migration
     * drift checks see the unique index.
     */
    tenantSourceSectionUniq: uniqueIndex(
      'intelligence_corpus_chunks_tenant_source_section_uniq',
    ).on(
      sql`COALESCE(${t.tenantId}, '')`,
      t.sourceFile,
      sql`COALESCE(${t.section}, '')`,
    ),
    langIdx: index('intelligence_corpus_chunks_lang_idx').on(t.language),
    supersededIdx: index('intelligence_corpus_chunks_superseded_idx').on(
      t.supersededById,
    ),
  }),
);

export type IntelligenceCorpusChunk = typeof intelligenceCorpusChunks.$inferSelect;
export type NewIntelligenceCorpusChunk = typeof intelligenceCorpusChunks.$inferInsert;
