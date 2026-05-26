-- ─────────────────────────────────────────────────────────────────────
-- Migration 0133 — Voyager skill registry.
--
-- C5 / Phase A — Progressive Intelligence.
--
-- The brain promotes successful trace clusters into named callable
-- skills during the nightly consolidation pass (stage 04-promote).
-- Each row is namespaced (per-tenant + global) and keyed by a stable
-- `code_hash` so the promote stage can `ON CONFLICT DO UPDATE` to bump
-- counters without inserting duplicates.
--
-- Retrieval is cosine-similarity against the kernel's query embedding
-- via pgvector `<=>`. The migration depends on the `vector` extension
-- enabled by 0125 (`kernel_memory_semantic_embedding`).
--
-- Idempotent: CREATE EXTENSION / TABLE / INDEX ... IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────

-- pgvector — wrapped in DO/EXCEPTION so apply-check against a stock
-- Postgres image (no pgvector) emits a NOTICE instead of aborting the
-- migration chain. See 0125 for the same pattern.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '0133: pgvector unavailable: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS skill_registry (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  nl_description          TEXT NOT NULL,
  description_embedding   vector(1536),
  tool_call_template      JSONB NOT NULL,
  success_count           INT NOT NULL DEFAULT 0,
  failure_count           INT NOT NULL DEFAULT 0,
  last_used_at            TIMESTAMPTZ,
  promoted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  code_hash               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_skill_registry_tenant_code_hash
  ON skill_registry (tenant_id, code_hash);

CREATE INDEX IF NOT EXISTS idx_skill_registry_tenant_status
  ON skill_registry (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_skill_registry_last_used
  ON skill_registry (last_used_at);

-- IVFFLAT cosine index — same pattern as migration 0125. Build over
-- non-null embeddings so a fresh deploy with zero rows doesn't trip
-- pgvector's "needs training data" build path. The DO block swallows
-- a build failure so the migration is non-fatal on first deploy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'skill_registry'
      AND indexname = 'idx_skill_registry_embedding_cos'
  ) THEN
    EXECUTE 'CREATE INDEX idx_skill_registry_embedding_cos
             ON skill_registry
             USING ivfflat (description_embedding vector_cosine_ops)
             WITH (lists = 100)
             WHERE description_embedding IS NOT NULL';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'idx_skill_registry_embedding_cos build deferred: %', SQLERRM;
END $$;

COMMENT ON TABLE skill_registry IS
  'Voyager-style procedural memory. tenant_id NULL = global skill. Promoted by services/consolidation-worker stage 04-promote.';
COMMENT ON COLUMN skill_registry.code_hash IS
  'sha256(toolName + canonical(input-shape)) — de-dupe key.';
COMMENT ON COLUMN skill_registry.status IS
  '''active'' (retrieved) | ''retired'' (kept for audit) | ''shadow'' (A/B promote).';
