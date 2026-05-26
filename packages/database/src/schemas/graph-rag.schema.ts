/**
 * GraphRAG router persistence (Wave 18BB).
 *
 * Companion to Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md. Drizzle types
 * for the four tables created by migration 0041_graph_rag.sql:
 *
 *   - knowledge_graph_entities    → one row per de-duped entity
 *                                   extracted from the corpus.
 *                                   Carries a pgvector(1536) embedding
 *                                   for graph-local fan-out from a
 *                                   query-matched seed entity.
 *                                   Tenant-scoped, RLS.
 *   - knowledge_graph_relations   → typed edges between two entities.
 *                                   Weight accumulates across corpus
 *                                   mentions. Tenant-scoped, RLS.
 *   - kg_communities              → one row per Leiden/Louvain
 *                                   community at any hierarchy level
 *                                   (Level 0 = fine, Level 1 = merged).
 *                                   `signature_hash` drives the
 *                                   sleep-pass drift-detection. Tenant-
 *                                   scoped, RLS.
 *   - kg_community_summaries      → LLM-generated summary per community
 *                                   version (append-only). The
 *                                   sleep-pass writes a new row only
 *                                   when the community's signature
 *                                   has drifted. Tenant-scoped, RLS.
 *
 * All four tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern) and carry an `audit_hash` derived via
 * `@borjie/audit-hash-chain`.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  customType,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Custom drizzle column wrapping pgvector at 1536 dimensions (OpenAI
 * text-embedding-3-large). Mirrors the pattern used by
 * `cognitive-memory.schema.ts` (migration 0029).
 */
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    const stripped = value.replace(/^\[|\]$/g, '');
    return stripped ? stripped.split(',').map(Number) : [];
  },
});

// ============================================================================
// knowledge_graph_entities — de-duped entity nodes
// ============================================================================

export const knowledgeGraphEntities = pgTable(
  'knowledge_graph_entities',
  {
    /** sha256-prefix derived from the canonicalised name (deterministic). */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Display name. Canonicalised (trimmed, internal whitespace collapsed). */
    name: text('name').notNull(),
    /** person | org | place | concept | asset | event | other */
    entityType: text('entity_type').notNull(),
    description: text('description').notNull().default(''),
    /** 1536-dim OpenAI text-embedding-3-large vector. */
    embedding: vector1536('embedding'),
    /** How many corpus chunks mention this entity. */
    mentionCount: integer('mention_count').notNull().default(1),
    /** Corpus-chunk ids that produced this entity (audit / provenance). */
    sourceChunkIds: text('source_chunk_ids')
      .array()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull().default(''),
  },
  (t) => ({
    tenantTypeIdx: index('idx_kg_entities_tenant_type').on(
      t.tenantId,
      t.entityType,
    ),
  }),
);

export type KnowledgeGraphEntityRow = typeof knowledgeGraphEntities.$inferSelect;
export type KnowledgeGraphEntityInsert =
  typeof knowledgeGraphEntities.$inferInsert;

// ============================================================================
// knowledge_graph_relations — typed edges
// ============================================================================

export const knowledgeGraphRelations = pgTable(
  'knowledge_graph_relations',
  {
    /** sha256-prefix derived from `(from, to, kind)`. */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    fromEntityId: text('from_entity_id').notNull(),
    toEntityId: text('to_entity_id').notNull(),
    /** Relation type — free-form, lowercased. */
    kind: text('kind').notNull(),
    description: text('description').notNull().default(''),
    /** Mention count — accumulates on duplicate upsert. */
    weight: integer('weight').notNull().default(1),
    sourceChunkIds: text('source_chunk_ids')
      .array()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull().default(''),
  },
  (t) => ({
    fromIdx: index('idx_kg_relations_tenant_from').on(t.tenantId, t.fromEntityId),
    toIdx: index('idx_kg_relations_tenant_to').on(t.tenantId, t.toEntityId),
    kindIdx: index('idx_kg_relations_kind').on(t.tenantId, t.kind),
  }),
);

export type KnowledgeGraphRelationRow =
  typeof knowledgeGraphRelations.$inferSelect;
export type KnowledgeGraphRelationInsert =
  typeof knowledgeGraphRelations.$inferInsert;

// ============================================================================
// kg_communities — Leiden/Louvain hierarchical clusters
// ============================================================================

export const kgCommunities = pgTable(
  'kg_communities',
  {
    /** sha256-prefix derived from `(tenant, level, signature_hash)`. */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Hierarchy level — 0 = finest, increasing toward coarser. */
    level: integer('level').notNull(),
    /** Parent community at level+1, if any (null for the topmost). */
    parentCommunityId: text('parent_community_id'),
    /** Sorted ids of member entities. */
    memberEntityIds: text('member_entity_ids')
      .array()
      .notNull()
      .default([]),
    /** sha256 of the sorted member-id set — cheap drift detector. */
    signatureHash: text('signature_hash').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull().default(''),
  },
  (t) => ({
    levelIdx: index('idx_kg_communities_tenant_level').on(t.tenantId, t.level),
  }),
);

export type KGCommunityRow = typeof kgCommunities.$inferSelect;
export type KGCommunityInsert = typeof kgCommunities.$inferInsert;

// ============================================================================
// kg_community_summaries — LLM-generated summaries (append-only)
// ============================================================================

export const kgCommunitySummaries = pgTable(
  'kg_community_summaries',
  {
    /** sha256-prefix derived from `(community_id, signature_hash)`. */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    communityId: text('community_id').notNull(),
    /** Markdown summary returned by the LLM. */
    summaryMd: text('summary_md').notNull(),
    /** Model id used (e.g. 'claude-opus-4-7'). */
    modelId: text('model_id').notNull(),
    /** Tokens spent generating this summary. */
    tokenCount: integer('token_count').notNull().default(0),
    /** Signature of the community at generation time (regen-key). */
    signatureHash: text('signature_hash').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull().default(''),
  },
  (t) => ({
    communityIdx: index('idx_kg_summaries_tenant_community').on(
      t.tenantId,
      t.communityId,
      t.generatedAt,
    ),
    signatureIdx: index('idx_kg_summaries_signature').on(
      t.tenantId,
      t.signatureHash,
    ),
  }),
);

export type KGCommunitySummaryRow = typeof kgCommunitySummaries.$inferSelect;
export type KGCommunitySummaryInsert = typeof kgCommunitySummaries.$inferInsert;
