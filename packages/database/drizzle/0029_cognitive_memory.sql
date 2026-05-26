-- =============================================================================
-- Migration 0029 — Unified Cognitive Memory schema (Wave 18AA)
--
-- Companion to docs/DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md. Adds the
-- persistence substrate for the unified cognitive memory store —
-- the single shared semantic memory that turns Mr. Mwikila and his
-- 27+ specialisations into ONE mind:
--
--   1. cognitive_memory_cells           — the unified store. One row
--                                          per memory cell. pgvector
--                                          embedding (1536-dim for
--                                          OpenAI text-embedding-3-
--                                          large). HNSW vector index.
--                                          Tenant-scoped, RLS-bound.
--   2. cognitive_memory_reinforcements  — one row per reinforce call.
--                                          Cross-specialisation audit
--                                          trail. Tenant-scoped, RLS.
--   3. platform_memory_cells            — federated cross-tenant cells
--                                          (PII-stripped). No RLS — by
--                                          design globally readable;
--                                          federation promoter is the
--                                          sole writer.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. cognitive_memory_cells — the unified shared semantic memory
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cognitive_memory_cells (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       text NOT NULL,
  -- 'tenant_root' or an org_unit_id. See spec §5.
  scope_id                        text NOT NULL,
  -- pattern | fact | rule | preference | template | citation | failure | terminology
  kind                            text NOT NULL,
  content_text                    text NOT NULL,
  content_structured              jsonb,
  -- OpenAI text-embedding-3-large output dimension.
  embedding                       vector(1536),
  -- agent_id (junior id or 'mr-mwikila') that first observed this cell.
  contributed_by_specialisation   text NOT NULL,
  reinforced_by_specialisations   text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- → cognitive_turns(id) when present. Nullable to allow seed cells.
  contributed_in_turn_id          uuid,
  reinforced_in_turn_ids          uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  -- SpanCitation[] — provenance + evidence carried by the cell.
  evidence_citations              jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score                numeric(3,2) NOT NULL DEFAULT 0.50,
  access_count                    integer NOT NULL DEFAULT 0,
  last_accessed_at                timestamptz,
  -- observed | reinforced | consolidated | decayed | contradicted
  promotion_status                text NOT NULL DEFAULT 'observed',
  -- when a cell is contradicted, this points to the cell that replaced it.
  contradicting_cell_id           uuid REFERENCES cognitive_memory_cells(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  promoted_at                     timestamptz,
  decayed_at                      timestamptz,
  audit_hash                      text NOT NULL,
  CONSTRAINT cmc_confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT cmc_kind_known CHECK (kind IN (
    'pattern','fact','rule','preference','template','citation','failure','terminology'
  )),
  CONSTRAINT cmc_status_known CHECK (promotion_status IN (
    'observed','reinforced','consolidated','decayed','contradicted'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cmc_tenant_scope
  ON cognitive_memory_cells (tenant_id, scope_id, promotion_status);
CREATE INDEX IF NOT EXISTS idx_cmc_specialisation
  ON cognitive_memory_cells (contributed_by_specialisation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmc_kind_status
  ON cognitive_memory_cells (tenant_id, kind, promotion_status);
-- HNSW vector index for fast cosine recall (top-N semantic search).
CREATE INDEX IF NOT EXISTS idx_cmc_embedding
  ON cognitive_memory_cells USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE cognitive_memory_cells ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cognitive_memory_cells'
       AND policyname = 'cmc_tenant_isolation'
  ) THEN
    CREATE POLICY cmc_tenant_isolation ON cognitive_memory_cells
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. cognitive_memory_reinforcements — cross-specialisation audit trail
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cognitive_memory_reinforcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id         uuid NOT NULL REFERENCES cognitive_memory_cells(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  specialisation  text NOT NULL,
  turn_id         uuid NOT NULL,
  reinforced_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cmr_cell
  ON cognitive_memory_reinforcements (cell_id, reinforced_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmr_tenant
  ON cognitive_memory_reinforcements (tenant_id, reinforced_at DESC);

ALTER TABLE cognitive_memory_reinforcements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cognitive_memory_reinforcements'
       AND policyname = 'cmr_tenant_isolation'
  ) THEN
    CREATE POLICY cmr_tenant_isolation ON cognitive_memory_reinforcements
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. platform_memory_cells — federated cross-tenant memory (NO RLS)
--
-- PII-stripped. Globally readable by design. The federation promoter
-- (running in the consolidation worker with a service role) is the
-- only writer. No tenant_id column — tenant provenance is collapsed
-- into source_tenant_count.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_memory_cells (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL,
  content_text        text NOT NULL,
  embedding           vector(1536),
  source_tenant_count integer NOT NULL,
  promotion_status    text NOT NULL DEFAULT 'observed',
  created_at          timestamptz NOT NULL DEFAULT now(),
  promoted_at         timestamptz,
  audit_hash          text NOT NULL,
  CONSTRAINT pmc_count_positive CHECK (source_tenant_count > 0),
  CONSTRAINT pmc_kind_known CHECK (kind IN (
    'pattern','fact','rule','preference','template','citation','failure','terminology'
  )),
  CONSTRAINT pmc_status_known CHECK (promotion_status IN (
    'observed','reinforced','consolidated','decayed','contradicted'
  ))
);

CREATE INDEX IF NOT EXISTS idx_pmc_embedding
  ON platform_memory_cells USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_pmc_kind_status
  ON platform_memory_cells (kind, promotion_status);

-- Note: platform_memory_cells has NO RLS — global by design. The
-- federation promoter is the only writer (service-role).

COMMIT;
