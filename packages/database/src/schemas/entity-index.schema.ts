/**
 * Entity Index + Cross References — Wave ENTITY-LEGIBILITY (migration 0115).
 *
 * Companion to:
 *   - packages/database/src/migrations/0115_entity_index.sql
 *   - services/api-gateway/src/workers/entity-indexer-worker.ts
 *   - services/api-gateway/src/composition/brain-tools/entity-legibility-tools.ts
 *   - services/api-gateway/src/services/cross-reference-discovery/
 *
 * Two tables back the "entire org fully legible to AI" contract:
 *
 *   - entity_index            one row per (tenant, kind, id) with a
 *                             semantic embedding + faceted tags +
 *                             summary so the brain can resolve any
 *                             natural-language phrase to a concrete
 *                             entity.
 *   - entity_cross_references typed (source -> target) edges so the
 *                             brain can traverse the graph in one hop
 *                             ("trace this incident back to its drill
 *                              hole assay").
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate.
 * RLS is FORCE-enabled on both tables per the Borjie hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';

// ─── pgvector custom type ────────────────────────────────────────────
// Mirrors `document-embeddings.schema.ts` so we keep one well-known
// pattern across the codebase. Switch to `vector({dimensions: N})`
// once the drizzle-orm pgvector helper lands as a non-optional dep.
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

/** OpenAI text-embedding-3-small dimensionality. Mirrors EMBEDDING_DIM
 *  in `document-embeddings.schema.ts`. */
export const ENTITY_EMBEDDING_DIM = 1536;

// ─── enums (text-typed at the API layer) ─────────────────────────────

export const ENTITY_LIFECYCLE_STAGES = [
  'draft',
  'active',
  'dormant',
  'archived',
  'deleted',
] as const;
export type EntityLifecycleStage = (typeof ENTITY_LIFECYCLE_STAGES)[number];

export const ENTITY_CROSS_REF_RELATIONSHIPS = [
  'parent',
  'child',
  'related',
  'duplicate',
  'depends_on',
  'supersedes',
] as const;
export type EntityCrossRefRelationship =
  (typeof ENTITY_CROSS_REF_RELATIONSHIPS)[number];

// ─── entity_index ────────────────────────────────────────────────────

export const entityIndex = pgTable(
  'entity_index',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Entity kind. Open enum at the DB layer; constrained at the API
     *  layer via the kind registry. */
    entityKind: text('entity_kind').notNull(),
    /** Stable identifier within the kind (uuid / slug / composite). */
    entityId: text('entity_id').notNull(),
    /** Human-readable label the brain returns to the owner. */
    displayName: text('display_name').notNull(),
    /** Optional 1536-dim embedding (null when no embedder configured). */
    embedding: vector(ENTITY_EMBEDDING_DIM)('embedding'),
    /** Faceted tags from canonical fields. */
    tags: text('tags').array().notNull().default([]),
    /** 1-2 sentence brain-quotable summary. */
    summary: text('summary').notNull().default(''),
    /** Bounded enum at the DB layer (Postgres `entity_lifecycle_stage`). */
    lifecycleStage: text('lifecycle_stage').notNull().default('active'),
    /** When the source row last changed (mirrors source.updated_at). */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the indexer last refreshed this row (drift tracking). */
    refreshedAt: timestamp('refreshed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    naturalKeyIdx: uniqueIndex('entity_index_natural_key_idx').on(
      table.tenantId,
      table.entityKind,
      table.entityId,
    ),
    recentIdx: index('entity_index_recent_idx').on(
      table.tenantId,
      table.entityKind,
      table.refreshedAt,
    ),
    tagsGinIdx: index('entity_index_tags_gin_idx').on(table.tags),
  }),
);

export type EntityIndexRow = typeof entityIndex.$inferSelect;
export type NewEntityIndexRow = typeof entityIndex.$inferInsert;

// ─── entity_cross_references ─────────────────────────────────────────

export const entityCrossReferences = pgTable(
  'entity_cross_references',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    /** Bounded enum at the DB layer (Postgres
     *  `entity_cross_ref_relationship`). */
    relationship: text('relationship').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 })
      .notNull()
      .default('1.000'),
    derivedAt: timestamp('derived_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Pure-function name in cross-reference-discovery that produced the
     *  edge (e.g. "discoverForRoyaltyDraft"). */
    derivationSource: text('derivation_source').notNull().default(''),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.tenantId,
        table.sourceKind,
        table.sourceId,
        table.targetKind,
        table.targetId,
        table.relationship,
      ],
    }),
    forwardIdx: index('entity_cross_references_forward_idx').on(
      table.tenantId,
      table.sourceKind,
      table.sourceId,
    ),
    reverseIdx: index('entity_cross_references_reverse_idx').on(
      table.tenantId,
      table.targetKind,
      table.targetId,
    ),
    relationshipIdx: index('entity_cross_references_relationship_idx').on(
      table.tenantId,
      table.relationship,
      table.sourceKind,
    ),
  }),
);

export type EntityCrossReferenceRow = typeof entityCrossReferences.$inferSelect;
export type NewEntityCrossReferenceRow =
  typeof entityCrossReferences.$inferInsert;
