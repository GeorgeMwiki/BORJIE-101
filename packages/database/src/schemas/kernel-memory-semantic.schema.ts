/**
 * Kernel memory — semantic store.
 *
 * Extracted facts: "User prefers Swahili greetings." "Property P-12 has
 * 3 vacant units." Has a confidence score (0..1), an optional TTL
 * (default never), the source-turn id that produced the fact, an
 * evidence_count for confirmation tracking, and a `source` channel that
 * records whether the fact was extracted automatically, declared by the
 * user, or written by the consolidation cycle.
 *
 * Per-(tenant, user) AND per-tenant variants share the same table:
 * tenant-scope facts have user_id = NULL.
 *
 * The composite uniqueness on (tenant_id, user_id, key) is enforced
 * with a partial-index pair (because Postgres treats NULLs as distinct
 * inside UNIQUE INDEX), so upserts can safely "on conflict" bump
 * evidence_count + last_seen_at + value.
 *
 * Query-conditioned retrieval (LITFIN parity — gap C in
 * `.planning/parity-litfin/02-memory-learning.md`):
 *   - `embedding` is an OPTIONAL pgvector column (1536 dims, matching
 *     OpenAI `text-embedding-3-small`) populated by the consolidation
 *     cycle when an embedding port is available. Drizzle has no native
 *     pgvector type, so we model it as `jsonb` here purely for shape;
 *     the underlying Postgres column is `VECTOR(1536)` (migration 0125)
 *     and the read path in `kernel-memory-semantic.service.ts` uses
 *     `<=>` cosine distance through raw SQL — Drizzle's column type is
 *     a stand-in that lets us SELECT / null-check the value at the ORM
 *     level without colliding with the pgvector extension's type.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  real,
  index,
  uniqueIndex,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * pgvector custom type — Drizzle has no built-in vector support, but
 * `customType` lets us declare the SQL column as `vector(N)` and round-
 * trip the value through TS as a `number[]`. The TS payload is the
 * Postgres text form of the vector (`[0.1,0.2,...]`) which pgvector
 * parses on both directions.
 */
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dims = config?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value || typeof value !== 'string') return [];
    const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
  },
});

export const kernelMemorySemanticSourceEnum = pgEnum(
  'kernel_memory_semantic_source',
  ['extracted', 'declared', 'consolidated'],
);

export const kernelMemorySemantic = pgTable(
  'kernel_memory_semantic',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Null for tenant-scope facts ("our office is in Dar es Salaam"). */
    userId: text('user_id'),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    confidence: real('confidence').notNull().default(0.5),
    sourceTurnId: text('source_turn_id'),
    evidenceCount: integer('evidence_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    source: kernelMemorySemanticSourceEnum('source')
      .notNull()
      .default('extracted'),
    /**
     * Optional embedding (text-embedding-3-small, 1536 dims) used by
     * `searchByEmbedding` for cosine-similarity retrieval. NULL when
     * the fact was written before the embedding migration or when the
     * consolidation cycle ran without an embedding port. The read path
     * filters NULLs out so missing embeddings degrade gracefully.
     */
    embedding: vector('embedding', { dimensions: 1536 }),
    /**
     * Resume marker for the bulk re-embedder (stage 07-re-embed).
     * NULL = never re-embedded (highest priority).
     * Migration 0141.
     */
    lastEmbeddedAt: timestamp('last_embedded_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserKeyUserIdx: uniqueIndex(
      'uniq_kernel_mem_semantic_tenant_user_key',
    ).on(t.tenantId, t.userId, t.key),
    tenantTimeIdx: index('idx_kernel_mem_semantic_tenant_time').on(
      t.tenantId,
      t.lastSeenAt,
    ),
    lastEmbeddedIdx: index('idx_kernel_mem_semantic_last_embedded').on(
      t.tenantId,
      t.lastEmbeddedAt,
    ),
  }),
);
