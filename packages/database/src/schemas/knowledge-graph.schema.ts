/**
 * kg_nodes + kg_edges (migration 0298) — durable backing store for the
 * Postgres `KGStorePort` adapter that makes `@borjie/knowledge-graph` real
 * (no Neo4j / no external graph DB).
 *
 * `kg_nodes` mirrors entities from the live mining tables (estate groups /
 * entities, staff, vendors, ore parcels) PLUS `corpus_chunk` nodes that point
 * at an existing `intelligence_corpus_chunks` row. `kg_edges` holds directed
 * relationships (owns / located-at / supplies / regulated-by / employs /
 * mentions) between two nodes in the SAME tenant.
 *
 * EMBEDDING REUSE (NO new embedder): `kg_nodes.embedding` is `vector(1024)` —
 * the same Cohere embed-v3 shape as `intelligence_corpus_chunks.embedding`. A
 * `corpus_chunk` node simply COPIES the precomputed embedding from its source
 * chunk; entity nodes leave it NULL. Nothing in this layer computes a new
 * embedding (no OpenAI / Cohere credential required for ingestion).
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors stage-advisor / inventory):
 * every tenant_id is TEXT and FK → tenants; both tables FORCE-enable RLS on the
 * canonical `app.current_tenant_id` GUC. The Postgres adapter ALSO filters
 * every read by tenantId for defence-in-depth.
 *
 * Companion to:
 *   - packages/database/src/migrations/0298_knowledge_graph.sql
 *   - services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts
 *   - services/api-gateway/src/composition/knowledge-graph/ingest.ts
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * pgvector column wrapper — matches `intelligence_corpus_chunks.embedding`
 * (vector(1024), Cohere embed-v3 multilingual). Stored as `vector(1024)` in
 * Postgres; serialised as `[0.1,0.2,...]` at the wire. The 0298 migration
 * ensures the `vector` extension exists. Only `corpus_chunk` nodes populate
 * this — and they COPY the source chunk's vector (never recompute).
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

export const kgNodes = pgTable(
  'kg_nodes',
  {
    /** Deterministic slug, e.g. `estate_entity:<uuid>` / `corpus_chunk:<id>`. */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Ontology class / node kind (maps to the package `Node.class`). */
    kind: text('kind').notNull(),
    /** Natural key into the SOURCE table (idempotent upsert + citation back-ref). */
    entityRef: text('entity_ref').notNull(),
    /** Human-readable label for viz / breadcrumbs. */
    label: text('label').notNull().default(''),
    /** Optional COPY of the source chunk's Cohere-1024 embedding (chunks only). */
    embedding: vector1024('embedding'),
    /** Free-form properties (the package `Node.properties`). */
    props: jsonb('props').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Idempotent upsert key: one node per (tenant, kind, entity_ref). */
    tenantKindRefUniq: uniqueIndex('kg_nodes_tenant_kind_ref_uniq').on(
      t.tenantId,
      t.kind,
      t.entityRef,
    ),
    tenantIdx: index('kg_nodes_tenant_idx').on(t.tenantId),
    tenantKindIdx: index('kg_nodes_tenant_kind_idx').on(t.tenantId, t.kind),
  }),
);

export const kgEdges = pgTable(
  'kg_edges',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Source node id (FK → kg_nodes.id, same tenant). */
    srcNodeId: text('src_node_id')
      .notNull()
      .references(() => kgNodes.id, { onDelete: 'cascade' }),
    /** Destination node id (FK → kg_nodes.id, same tenant). */
    dstNodeId: text('dst_node_id')
      .notNull()
      .references(() => kgNodes.id, { onDelete: 'cascade' }),
    /** Relationship label (the package `Edge.label`). */
    relation: text('relation').notNull(),
    /** Optional edge weight (similarity / strength); defaults to 1. */
    weight: doublePrecision('weight').notNull().default(1),
    props: jsonb('props').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Idempotent upsert key: one edge per (tenant, src, dst, relation). */
    tenantTripleUniq: uniqueIndex('kg_edges_tenant_triple_uniq').on(
      t.tenantId,
      t.srcNodeId,
      t.dstNodeId,
      t.relation,
    ),
    tenantIdx: index('kg_edges_tenant_idx').on(t.tenantId),
    tenantSrcIdx: index('kg_edges_tenant_src_idx').on(t.tenantId, t.srcNodeId),
    tenantDstIdx: index('kg_edges_tenant_dst_idx').on(t.tenantId, t.dstNodeId),
  }),
);

export type KgNode = typeof kgNodes.$inferSelect;
export type NewKgNode = typeof kgNodes.$inferInsert;
export type KgEdge = typeof kgEdges.$inferSelect;
export type NewKgEdge = typeof kgEdges.$inferInsert;
