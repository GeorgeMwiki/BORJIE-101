/**
 * Document Embeddings Schema (NEW 15)
 *
 * Stores chunk-level text + vector embeddings for documents, enabling
 * retrieval-augmented document chat. Uses the pgvector extension for
 * cosine similarity search.
 *
 * NOTE: the `embedding` column is declared via a custom SQL type so the
 * schema compiles without the `drizzle-orm/pg-core` pgvector helper
 * (which is an optional dependency). Switch to `vector({dimensions: N})`
 * once pgvector drizzle helpers are available in the project.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/** pgvector column type — stored as a string of comma-separated floats. */
const vector = (dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value) {
      return `[${value.join(',')}]`;
    },
    fromDriver(value) {
      const inner = String(value).replace(/^\[|\]$/g, '');
      return inner
        .split(',')
        .filter(Boolean)
        .map((n) => Number(n));
    },
  });

export const EMBEDDING_DIM = 1536; // OpenAI text-embedding-3-small

export const documentEmbeddings = pgTable(
  'document_embeddings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),

    chunkIndex: integer('chunk_index').notNull(),
    chunkText: text('chunk_text').notNull(),
    chunkMeta: jsonb('chunk_meta').default({}),

    embedding: vector(EMBEDDING_DIM)('embedding').notNull(),
    embeddingModel: text('embedding_model').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('document_embeddings_tenant_idx').on(table.tenantId),
    docIdx: index('document_embeddings_document_idx').on(table.documentId),
  })
);

export type DocumentEmbedding = typeof documentEmbeddings.$inferSelect;
export type NewDocumentEmbedding = typeof documentEmbeddings.$inferInsert;
