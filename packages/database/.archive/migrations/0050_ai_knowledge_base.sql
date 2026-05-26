-- =============================================================================
-- 0050: AI knowledge base — Wave-11 tenant-scoped institutional knowledge
-- =============================================================================
-- Per-tenant knowledge chunks with vector embeddings + citation metadata.
-- Separate from ai_semantic_memories (per-persona interaction memory) and
-- document_embeddings (per-document RAG) — this is the tenant's curated
-- institutional knowledge (policies, playbooks, compliance packs).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_source   TEXT NOT NULL,
  source_id          TEXT,
  source_url         TEXT,
  kind               TEXT NOT NULL DEFAULT 'knowledge_base'
    CHECK (kind IN ('knowledge_base', 'policy_pack', 'playbook', 'legal_reference')),
  title              TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL DEFAULT 0,
  content            TEXT NOT NULL,
  embedding          TEXT,
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  country_code       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_tenant
  ON ai_knowledge_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_kind
  ON ai_knowledge_chunks(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_source
  ON ai_knowledge_chunks(tenant_id, knowledge_source, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_country
  ON ai_knowledge_chunks(country_code) WHERE country_code IS NOT NULL;
