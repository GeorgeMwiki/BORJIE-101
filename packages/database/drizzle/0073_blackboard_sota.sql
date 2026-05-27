-- =============================================================================
-- Migration 0073 — Blackboard SOTA (Wave BLACKBOARD-CORE)
--
-- Companion to Docs/DESIGN/BLACKBOARD_SOTA_2026.md and the
-- @borjie/blackboard-sota package (packages/blackboard-sota/).
--
-- The architectural upgrade above Wave 18HH's blackboard_postings
-- primitive (migration 0060). Classic Erman/Hayes-Roth blackboard
-- modernised for multi-agent LLM systems: regions, knowledge sources,
-- threaded posts with embeddings, cross-references, and summaries.
--
-- Persona: Mr. Mwikila. Brand: Borjie.
--
-- Four tables, all tenant-scoped with the canonical `app.tenant_id`
-- GUC RLS pattern from migration 0003:
--
--   blackboard_regions
--     One row per scoped problem-solving namespace
--     ('incident-investigation:KAH-088',
--      'royalty-filing-prep:2026-05',
--      'deep-research-session:abc123', ...).
--     Per-region audit chain (prev_hash / audit_hash).
--
--   blackboard_knowledge_sources
--     One row per KS. ks_kind in {junior, connector, tool, user,
--     external-feed}. region_filter text[] gates which regions the KS
--     claims competence on. priority real in [0, 1]. UNIQUE on
--     (tenant_id, ks_kind, ks_name).
--
--   blackboard_posts_v2
--     The threaded successor to 18HH's blackboard_postings. FK to
--     blackboard_regions and blackboard_knowledge_sources. Carries
--     content text + 1536-dim pgvector embedding + structured jsonb.
--     parent_post_id supports shallow threading (1 level). edit_count
--     tracks amendments. Hash-chains into the region's chain.
--
--   blackboard_cross_references
--     One row per detected reference between two posts. ref_kind in
--     {cites, contradicts, answers, supersedes, elaborates}.
--     confidence real in [0, 1]. UNIQUE on (tenant_id, src_post_id,
--     dst_post_id, ref_kind) keeps the table deduplicated.
--
--   blackboard_summaries
--     One row per rolling / final / digest summary. covers_from /
--     covers_to timestamps fence the summary window. Hash-chains into
--     the region's chain so a tampered summary breaks verification.
--
-- Coexistence: the 18HH `blackboard_postings` table is NOT dropped.
-- It coexists. A later wave (BLACKBOARD-DRIZZLE) introduces a unified
-- read view; consumers migrate incrementally.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. blackboard_regions — per-namespace problem-solving scope
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_regions (
  -- Region id is a stable text identifier like
  -- 'incident-investigation:KAH-088' so consumers can look up by
  -- semantic key without an extra index lookup.
  id              text NOT NULL,
  tenant_id       text NOT NULL,
  scope_id        text,
  -- region_kind enumeration — see spec §3.3
  region_kind     text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  -- Per-region audit chain.
  prev_hash       text NOT NULL DEFAULT '',
  audit_hash      text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_regions_kind_chk'
  ) THEN
    ALTER TABLE blackboard_regions
      ADD CONSTRAINT blackboard_regions_kind_chk
      CHECK (region_kind IN (
        'incident-investigation',
        'royalty-filing-prep',
        'buyer-deal-room',
        'shift-planning',
        'regulator-correspondence',
        'deep-research-session',
        'dashboard-composition'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_regions_status_chk'
  ) THEN
    ALTER TABLE blackboard_regions
      ADD CONSTRAINT blackboard_regions_status_chk
      CHECK (status IN ('open', 'active', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_regions_audit_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_regions
      ADD CONSTRAINT blackboard_regions_audit_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bbr_tenant_kind_status
  ON blackboard_regions (tenant_id, region_kind, status);

CREATE INDEX IF NOT EXISTS idx_bbr_tenant_opened
  ON blackboard_regions (tenant_id, opened_at DESC);

ALTER TABLE blackboard_regions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_regions'
       AND policyname = 'blackboard_regions_tenant_isolation'
  ) THEN
    CREATE POLICY blackboard_regions_tenant_isolation
      ON blackboard_regions
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. blackboard_knowledge_sources — KS registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_knowledge_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  ks_kind         text NOT NULL,
  ks_name         text NOT NULL,
  -- region kinds this KS claims competence on. Empty array = all.
  region_filter   text[] NOT NULL DEFAULT ARRAY[]::text[],
  priority        real NOT NULL DEFAULT 0.5,
  audit_hash      text NOT NULL,
  CONSTRAINT blackboard_ks_unique_per_tenant UNIQUE (tenant_id, ks_kind, ks_name)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_ks_kind_chk'
  ) THEN
    ALTER TABLE blackboard_knowledge_sources
      ADD CONSTRAINT blackboard_ks_kind_chk
      CHECK (ks_kind IN (
        'junior', 'connector', 'tool', 'user', 'external-feed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_ks_priority_bounds_chk'
  ) THEN
    ALTER TABLE blackboard_knowledge_sources
      ADD CONSTRAINT blackboard_ks_priority_bounds_chk
      CHECK (priority >= 0.0 AND priority <= 1.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_ks_name_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_knowledge_sources
      ADD CONSTRAINT blackboard_ks_name_nonempty_chk
      CHECK (length(ks_name) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bbks_tenant_kind
  ON blackboard_knowledge_sources (tenant_id, ks_kind);

ALTER TABLE blackboard_knowledge_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_knowledge_sources'
       AND policyname = 'blackboard_ks_tenant_isolation'
  ) THEN
    CREATE POLICY blackboard_ks_tenant_isolation
      ON blackboard_knowledge_sources
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. blackboard_posts_v2 — threaded posts with embeddings
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_posts_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  region_id       text NOT NULL,
  ks_id           uuid NOT NULL REFERENCES blackboard_knowledge_sources(id) ON DELETE RESTRICT,
  parent_post_id  uuid,
  content         text NOT NULL,
  content_embedding vector(1536),
  structured      jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz NOT NULL DEFAULT now(),
  edit_count      integer NOT NULL DEFAULT 0,
  prev_hash       text NOT NULL DEFAULT '',
  audit_hash      text NOT NULL,
  -- FK to (tenant_id, region_id) composite
  CONSTRAINT blackboard_posts_v2_region_fk
    FOREIGN KEY (tenant_id, region_id)
    REFERENCES blackboard_regions(tenant_id, id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_posts_v2_content_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_posts_v2
      ADD CONSTRAINT blackboard_posts_v2_content_nonempty_chk
      CHECK (length(content) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_posts_v2_audit_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_posts_v2
      ADD CONSTRAINT blackboard_posts_v2_audit_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_posts_v2_edit_count_nonneg_chk'
  ) THEN
    ALTER TABLE blackboard_posts_v2
      ADD CONSTRAINT blackboard_posts_v2_edit_count_nonneg_chk
      CHECK (edit_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bbp_v2_tenant_region_posted
  ON blackboard_posts_v2 (tenant_id, region_id, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_bbp_v2_parent
  ON blackboard_posts_v2 (tenant_id, parent_post_id)
  WHERE parent_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bbp_v2_ks
  ON blackboard_posts_v2 (tenant_id, ks_id, posted_at DESC);

ALTER TABLE blackboard_posts_v2 ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_posts_v2'
       AND policyname = 'blackboard_posts_v2_tenant_isolation'
  ) THEN
    CREATE POLICY blackboard_posts_v2_tenant_isolation
      ON blackboard_posts_v2
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. blackboard_cross_references — detected post-to-post links
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_cross_references (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  src_post_id     uuid NOT NULL REFERENCES blackboard_posts_v2(id) ON DELETE CASCADE,
  dst_post_id     uuid NOT NULL REFERENCES blackboard_posts_v2(id) ON DELETE CASCADE,
  ref_kind        text NOT NULL,
  confidence      real NOT NULL DEFAULT 1.0,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  CONSTRAINT blackboard_xref_unique
    UNIQUE (tenant_id, src_post_id, dst_post_id, ref_kind)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_xref_kind_chk'
  ) THEN
    ALTER TABLE blackboard_cross_references
      ADD CONSTRAINT blackboard_xref_kind_chk
      CHECK (ref_kind IN (
        'cites', 'contradicts', 'answers', 'supersedes', 'elaborates'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_xref_confidence_bounds_chk'
  ) THEN
    ALTER TABLE blackboard_cross_references
      ADD CONSTRAINT blackboard_xref_confidence_bounds_chk
      CHECK (confidence >= 0.0 AND confidence <= 1.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_xref_distinct_endpoints_chk'
  ) THEN
    ALTER TABLE blackboard_cross_references
      ADD CONSTRAINT blackboard_xref_distinct_endpoints_chk
      CHECK (src_post_id <> dst_post_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bbxref_tenant_src
  ON blackboard_cross_references (tenant_id, src_post_id);

CREATE INDEX IF NOT EXISTS idx_bbxref_tenant_dst
  ON blackboard_cross_references (tenant_id, dst_post_id);

ALTER TABLE blackboard_cross_references ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_cross_references'
       AND policyname = 'blackboard_xref_tenant_isolation'
  ) THEN
    CREATE POLICY blackboard_xref_tenant_isolation
      ON blackboard_cross_references
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. blackboard_summaries — token-budgeted rolling / final / digest summaries
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_summaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  region_id       text NOT NULL,
  summary_kind    text NOT NULL,
  summary_text    text NOT NULL,
  token_count     integer NOT NULL DEFAULT 0,
  covers_from     timestamptz NOT NULL,
  covers_to       timestamptz NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  CONSTRAINT blackboard_summaries_region_fk
    FOREIGN KEY (tenant_id, region_id)
    REFERENCES blackboard_regions(tenant_id, id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_summaries_kind_chk'
  ) THEN
    ALTER TABLE blackboard_summaries
      ADD CONSTRAINT blackboard_summaries_kind_chk
      CHECK (summary_kind IN ('rolling', 'final', 'digest'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_summaries_text_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_summaries
      ADD CONSTRAINT blackboard_summaries_text_nonempty_chk
      CHECK (length(summary_text) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_summaries_window_ordered_chk'
  ) THEN
    ALTER TABLE blackboard_summaries
      ADD CONSTRAINT blackboard_summaries_window_ordered_chk
      CHECK (covers_to >= covers_from);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'blackboard_summaries_token_nonneg_chk'
  ) THEN
    ALTER TABLE blackboard_summaries
      ADD CONSTRAINT blackboard_summaries_token_nonneg_chk
      CHECK (token_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bbsum_tenant_region_generated
  ON blackboard_summaries (tenant_id, region_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bbsum_tenant_kind
  ON blackboard_summaries (tenant_id, summary_kind, generated_at DESC);

ALTER TABLE blackboard_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_summaries'
       AND policyname = 'blackboard_summaries_tenant_isolation'
  ) THEN
    CREATE POLICY blackboard_summaries_tenant_isolation
      ON blackboard_summaries
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
