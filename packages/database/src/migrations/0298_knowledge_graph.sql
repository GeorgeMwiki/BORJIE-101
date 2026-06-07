-- =============================================================================
-- Migration 0298 — knowledge_graph (kg_nodes + kg_edges).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/knowledge-graph` ships a pluggable `KGStorePort` (upsertNode /
-- upsertEdge / getNode / getNeighbors / match / allNodes / allEdges) with an
-- in-memory default and *stub* KuzuDB / Neo4j adapters that throw until a
-- driver is wired. There was no DURABLE, multi-tenant, production graph store
-- the api-gateway could bind — so the GraphRAG half of the chat retrieval path
-- (neighbourhood expansion around the vector top-K) had nowhere to read from.
--
-- This migration stands up the REAL backing tables for a Postgres-backed
-- `KGStorePort` adapter (no Neo4j, no external graph DB):
--
--   * kg_nodes  — one row per graph node (entities mirrored from the live
--                 mining tables — estate groups/entities, staff, vendors, ore
--                 parcels — PLUS `corpus_chunk` nodes that point at an existing
--                 `intelligence_corpus_chunks` row). `entity_ref` carries the
--                 source-table primary key so ingestion is an idempotent UPSERT
--                 keyed by natural identity, never a duplicate-on-rerun.
--   * kg_edges  — one row per directed relationship (owns / located-at /
--                 supplies / regulated-by / mentions / employs ...). Endpoints
--                 are kg_nodes ids in the SAME tenant.
--
-- EMBEDDING REUSE (NO NEW EMBEDDER / NO OPENAI CRED): `kg_nodes.embedding` is
-- `vector(1024)` — byte-identical in shape to
-- `intelligence_corpus_chunks.embedding` (Cohere embed-v3 multilingual, 1024-d).
-- A `corpus_chunk` node simply COPIES the precomputed embedding from its source
-- chunk (SELECT … embedding … FROM intelligence_corpus_chunks). Entity nodes
-- leave it NULL. NOTHING here computes a new embedding; the column exists only
-- so the GraphRAG layer can rank neighbour chunks against an already-embedded
-- query using the same vector the corpus already stores. The pgvector
-- extension is created defensively (it already exists from the corpus
-- migration).
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0289 / 0292):
--   tenant_id is TEXT and FK → tenants(id); BOTH tables ENABLE + FORCE ROW
--   LEVEL SECURITY with a tenant policy on the canonical
--   `app.current_tenant_id` GUC (the GUC the api-gateway databaseMiddleware /
--   withTenantContext binds). The compare is bare (no cast) because tenant_id
--   is already TEXT. NEVER the legacy app.tenant_id. An edge can only ever join
--   two nodes in the same tenant (the FK + RLS guarantee it).
--
-- ID DISCIPLINE: `id` is TEXT (the adapter mints deterministic slugs such as
-- `estate_entity:<uuid>` / `corpus_chunk:<chunkId>`) — matching the package's
-- `Node.id: string` / `Edge.id: string`. NOT a uuid default.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): there is no money column here —
-- any monetary fact a node carries lives inside the free-form `props` jsonb as
-- minor-units + currency, never a typed money column and never a literal.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE/INDEX IF NOT EXISTS, guarded
-- DO-blocks (pg_policies checks), and a pg_roles guard around the anon REVOKE.
-- On a fully-migrated DB this is a pure no-op. References only pre-existing
-- infra (`tenants`, pgvector). 0298 is free; the highest used migration is 0297.
--
-- Companion files:
--   * packages/database/src/schemas/knowledge-graph.schema.ts
--   * services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts
--   * services/api-gateway/src/composition/knowledge-graph/ingest.ts
--   * services/api-gateway/src/routes/mining/knowledge-graph.hono.ts
--
-- The reverse (DOWN) script is embedded — COMMENTED — at the foot of this file
-- (per the in-file-DOWN convention for this change). It is dev/staging only:
-- dropping these tables loses the entire derived graph (which is rebuildable by
-- re-running ingestion, so there is no source-of-truth data loss).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgvector — already present from the intelligence_corpus_chunks migration;
-- created defensively so a fresh DB that applies 0298 in isolation still works.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- kg_nodes — one row per graph node (entity mirror OR corpus-chunk pointer).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kg_nodes (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Ontology class / node kind: 'estate_group' | 'estate_entity' | 'staff'
  -- | 'vendor' | 'ore_parcel' | 'corpus_chunk' | ... (free text; the adapter
  -- maps it to the package `Node.class`).
  kind         text        NOT NULL,
  -- Natural key into the SOURCE table (e.g. estate_entities.id /
  -- intelligence_corpus_chunks.id) so ingestion UPSERTs idempotently and the
  -- GraphRAG layer can resolve a node back to a real, citable row.
  entity_ref   text        NOT NULL,
  -- Human-readable label for viz / breadcrumbs.
  label        text        NOT NULL DEFAULT '',
  -- OPTIONAL pgvector — for `corpus_chunk` nodes this is a COPY of the source
  -- chunk's precomputed Cohere-1024 embedding (NO new embedder is ever run).
  -- Entity nodes leave it NULL.
  embedding    vector(1024),
  -- Free-form key/value bag persisted as node properties (the package's
  -- `Node.properties`). Money facts live here as minor-units + currency.
  props        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One node per (tenant, kind, entity_ref): the idempotent upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS kg_nodes_tenant_kind_ref_uniq
  ON kg_nodes (tenant_id, kind, entity_ref);

CREATE INDEX IF NOT EXISTS kg_nodes_tenant_idx
  ON kg_nodes (tenant_id);

CREATE INDEX IF NOT EXISTS kg_nodes_tenant_kind_idx
  ON kg_nodes (tenant_id, kind);

-- -----------------------------------------------------------------------------
-- kg_edges — directed relationships between two kg_nodes in the SAME tenant.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kg_edges (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  src_node_id  text        NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  dst_node_id  text        NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  -- Relationship label (the package's `Edge.label`): 'owns' | 'located-at'
  -- | 'supplies' | 'regulated-by' | 'employs' | 'mentions' | ...
  relation     text        NOT NULL,
  -- Optional edge weight (e.g. similarity / strength). Defaults to 1.
  weight       double precision NOT NULL DEFAULT 1,
  props        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One edge per (tenant, src, dst, relation): the idempotent upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS kg_edges_tenant_triple_uniq
  ON kg_edges (tenant_id, src_node_id, dst_node_id, relation);

CREATE INDEX IF NOT EXISTS kg_edges_tenant_idx
  ON kg_edges (tenant_id);

-- Neighbour-expansion hot paths (out-edges and in-edges of a node).
CREATE INDEX IF NOT EXISTS kg_edges_tenant_src_idx
  ON kg_edges (tenant_id, src_node_id);

CREATE INDEX IF NOT EXISTS kg_edges_tenant_dst_idx
  ON kg_edges (tenant_id, dst_node_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (FORCE so the table owner
-- cannot bypass it either). An edge can only reference nodes in the same
-- tenant: both the FK and these policies enforce single-tenant subgraphs.
-- -----------------------------------------------------------------------------

ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_nodes FORCE  ROW LEVEL SECURITY;
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edges FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kg_nodes'
       AND policyname = 'kg_nodes_tenant_isolation'
  ) THEN
    CREATE POLICY kg_nodes_tenant_isolation
      ON kg_nodes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kg_edges'
       AND policyname = 'kg_edges_tenant_isolation'
  ) THEN
    CREATE POLICY kg_edges_tenant_isolation
      ON kg_edges
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.kg_nodes FROM anon;';
    EXECUTE 'REVOKE ALL ON public.kg_edges FROM anon;';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN (dev/staging only — reverses 0298). Dropping these tables loses the
-- DERIVED graph only; it is fully rebuildable by re-running corpus ingestion,
-- so there is no source-of-truth data loss. To roll back, run the block below.
-- Drop order: kg_edges first (FK → kg_nodes), then kg_nodes.
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS kg_edges_tenant_isolation ON kg_edges;
-- DROP POLICY IF EXISTS kg_nodes_tenant_isolation ON kg_nodes;
--
-- DROP INDEX IF EXISTS kg_edges_tenant_dst_idx;
-- DROP INDEX IF EXISTS kg_edges_tenant_src_idx;
-- DROP INDEX IF EXISTS kg_edges_tenant_idx;
-- DROP INDEX IF EXISTS kg_edges_tenant_triple_uniq;
-- DROP INDEX IF EXISTS kg_nodes_tenant_kind_idx;
-- DROP INDEX IF EXISTS kg_nodes_tenant_idx;
-- DROP INDEX IF EXISTS kg_nodes_tenant_kind_ref_uniq;
--
-- DROP TABLE IF EXISTS kg_edges;
-- DROP TABLE IF EXISTS kg_nodes;
--
-- COMMIT;
-- =============================================================================
