-- =============================================================================
-- 0038: AI semantic memory — Wave-11 AI memory layer
-- =============================================================================
-- Per-tenant, per-persona vector store for long-lived conversational memory.
-- Uses pgvector when available; falls back to TEXT (JSON-serialized embedding)
-- if the extension is not installed so the migration still applies.
-- =============================================================================

-- Opportunistic: only creates the type if pgvector is available.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ai_semantic_memories (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id         TEXT,
  memory_type        TEXT NOT NULL DEFAULT 'interaction',
  content            TEXT NOT NULL,
  embedding          TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence         DOUBLE PRECISION NOT NULL DEFAULT 0.8
    CHECK (confidence >= 0 AND confidence <= 1),
  decay_score        DOUBLE PRECISION NOT NULL DEFAULT 1.0
    CHECK (decay_score >= 0 AND decay_score <= 1),
  access_count       INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  session_id         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant_persona
  ON ai_semantic_memories(tenant_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant_decay
  ON ai_semantic_memories(tenant_id, decay_score DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memory_last_access
  ON ai_semantic_memories(last_accessed_at DESC);
