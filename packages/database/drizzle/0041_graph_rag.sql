-- =============================================================================
-- Migration 0041 — GraphRAG router schema (Wave 18BB)
--
-- Companion to Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md. Adds four
-- tenant-scoped tables that back the hierarchical-retrieval
-- substrate. Closes the founder-flagged P0 gap: "GraphRAG
-- hierarchical retrieval is not the default — knowledge-graph
-- exists but everything routes through pgvector; no community
-- summaries."
--
--   1. knowledge_graph_entities      — one row per de-duped entity
--                                      surfaced by the corpus-build
--                                      LLM extractor. Carries a
--                                      pgvector(1536) embedding for
--                                      local-search fan-out from
--                                      named entities.
--   2. knowledge_graph_relations     — typed edges between two
--                                      entities. Weight accumulates
--                                      across corpus mentions.
--   3. kg_communities                — one row per Leiden/Louvain
--                                      community at any hierarchy
--                                      level. `signature_hash` lets
--                                      the sleep-pass detect drift
--                                      in O(1).
--   4. kg_community_summaries        — LLM-generated summary per
--                                      community version. Append-only
--                                      via the (community_id,
--                                      signature_hash) unique key.
--
-- All four tables enable Postgres RLS via the canonical
-- `app.tenant_id` GUC policy from migration 0003. Idempotent (IF
-- NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. knowledge_graph_entities — one row per canonicalised entity
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_graph_entities (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  name                text NOT NULL,
  entity_type         text NOT NULL,
  description         text NOT NULL DEFAULT '',
  embedding           vector(1536),
  mention_count       integer NOT NULL DEFAULT 1,
  source_chunk_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL DEFAULT '',
  CONSTRAINT kg_entities_type_chk CHECK (entity_type IN (
    'person','org','place','concept','asset','event','other'
  )),
  CONSTRAINT kg_entities_mention_nonneg CHECK (mention_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_entities_tenant_name
  ON knowledge_graph_entities (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_type
  ON knowledge_graph_entities (tenant_id, entity_type);

-- HNSW vector index for local-search fan-out. m=16, ef_construction=64
-- is the canonical default — same as cognitive_memory_cells (0029).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'knowledge_graph_entities'
       AND indexname  = 'idx_kg_entities_embedding_hnsw'
  ) THEN
    CREATE INDEX idx_kg_entities_embedding_hnsw
      ON knowledge_graph_entities
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END$$;

ALTER TABLE knowledge_graph_entities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'knowledge_graph_entities'
       AND policyname = 'kg_entities_tenant_isolation'
  ) THEN
    CREATE POLICY kg_entities_tenant_isolation ON knowledge_graph_entities
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. knowledge_graph_relations — typed edges between entities
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_graph_relations (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  from_entity_id      text NOT NULL REFERENCES knowledge_graph_entities(id) ON DELETE CASCADE,
  to_entity_id        text NOT NULL REFERENCES knowledge_graph_entities(id) ON DELETE CASCADE,
  kind                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  weight              integer NOT NULL DEFAULT 1,
  source_chunk_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL DEFAULT '',
  CONSTRAINT kg_relations_weight_positive CHECK (weight > 0),
  CONSTRAINT kg_relations_not_self_loop CHECK (from_entity_id <> to_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_kg_relations_tenant_from
  ON knowledge_graph_relations (tenant_id, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_tenant_to
  ON knowledge_graph_relations (tenant_id, to_entity_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_kind
  ON knowledge_graph_relations (tenant_id, kind);

ALTER TABLE knowledge_graph_relations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'knowledge_graph_relations'
       AND policyname = 'kg_relations_tenant_isolation'
  ) THEN
    CREATE POLICY kg_relations_tenant_isolation ON knowledge_graph_relations
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. kg_communities — hierarchical clusters detected by Leiden/Louvain
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kg_communities (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  level               integer NOT NULL,
  parent_community_id text REFERENCES kg_communities(id) ON DELETE SET NULL,
  member_entity_ids   text[] NOT NULL DEFAULT ARRAY[]::text[],
  signature_hash      text NOT NULL,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL DEFAULT '',
  CONSTRAINT kg_communities_level_nonneg CHECK (level >= 0),
  CONSTRAINT kg_communities_signature_nonempty CHECK (length(signature_hash) > 0)
);

CREATE INDEX IF NOT EXISTS idx_kg_communities_tenant_level
  ON kg_communities (tenant_id, level);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_communities_tenant_signature
  ON kg_communities (tenant_id, level, signature_hash);

ALTER TABLE kg_communities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kg_communities'
       AND policyname = 'kg_communities_tenant_isolation'
  ) THEN
    CREATE POLICY kg_communities_tenant_isolation ON kg_communities
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 4. kg_community_summaries — LLM-generated summaries (append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kg_community_summaries (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  community_id        text NOT NULL REFERENCES kg_communities(id) ON DELETE CASCADE,
  summary_md          text NOT NULL,
  model_id            text NOT NULL,
  token_count         integer NOT NULL DEFAULT 0,
  signature_hash      text NOT NULL,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL DEFAULT '',
  CONSTRAINT kg_summaries_token_nonneg CHECK (token_count >= 0),
  CONSTRAINT kg_summaries_summary_nonempty CHECK (length(summary_md) > 0)
);

CREATE INDEX IF NOT EXISTS idx_kg_summaries_tenant_community
  ON kg_community_summaries (tenant_id, community_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kg_summaries_signature
  ON kg_community_summaries (tenant_id, signature_hash);

ALTER TABLE kg_community_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kg_community_summaries'
       AND policyname = 'kg_summaries_tenant_isolation'
  ) THEN
    CREATE POLICY kg_summaries_tenant_isolation ON kg_community_summaries
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- Comments — table-level documentation pointers
-- -----------------------------------------------------------------------------

COMMENT ON TABLE knowledge_graph_entities IS
  'Wave 18BB — GraphRAG entity nodes. See Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md.';
COMMENT ON TABLE knowledge_graph_relations IS
  'Wave 18BB — GraphRAG typed edges between entities.';
COMMENT ON TABLE kg_communities IS
  'Wave 18BB — Leiden/Louvain communities. signature_hash drives drift detection in the nightly sleep pass.';
COMMENT ON TABLE kg_community_summaries IS
  'Wave 18BB — LLM-generated community summaries. Append-only; the sleep pass writes a new row per signature drift.';

COMMIT;
