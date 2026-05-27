-- =============================================================================
-- Migration 0074 — Blackboard Intelligence (Wave BLACKBOARD-INTEL)
--
-- Companion to Docs/DESIGN/BLACKBOARD_INTEL_SOTA_2026.md.
--
-- Wires the blackboard into the self-improving loop and provides the
-- persistence substrate for hybrid (FTS + dense) search across the
-- entire posting history. Sibling wave BLACKBOARD-CORE owns
-- `blackboard_posts_v2`; this migration adds two new tables that
-- depend on it via post_id and stand alone if BLACKBOARD-CORE has not
-- yet landed (the FK is declared as a soft reference — see notes).
--
-- Two tables:
--
--   1. blackboard_post_quality_scores — one row per (post_id, axis)
--                                       per scoring tick. axis is
--                                       'groundedness', 'calibration',
--                                       or 'utility'. Hash-chained per
--                                       (tenant_id) so the score
--                                       history is forensic-replayable.
--   2. blackboard_search_index        — full-text-search projection
--                                       over `content`. content_tsvector
--                                       is a STORED generated column
--                                       so the GIN index is always
--                                       hot. PK on post_id.
--
-- Both tables are tenant-scoped via the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from
-- migration 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
--
-- Sibling-wave notes:
--   - blackboard_posts_v2(id, content, content_embedding) is built by
--     BLACKBOARD-CORE. Until that table exists, this migration
--     defines `post_id` as `uuid NOT NULL` and **does not** declare
--     an SQL-level FK; the application repository enforces FK
--     consistency. The TODO at the bottom of this file records the
--     FK we add once BLACKBOARD-CORE has merged.
--   - The pgvector HNSW index on content_embedding lives in
--     BLACKBOARD-CORE's migration; this file deliberately does not
--     create it.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. blackboard_post_quality_scores — three-axis quality scoring ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_post_quality_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  /** Post identifier — soft FK to blackboard_posts_v2.id (see header). */
  post_id     uuid NOT NULL,
  /** Scoring axis — 'groundedness' | 'calibration' | 'utility'. */
  axis        text NOT NULL,
  /** Score in [0, 1]. */
  score       real NOT NULL,
  scored_at   timestamptz NOT NULL DEFAULT now(),
  /** Hash of the previous score row in this tenant's chain. */
  prev_hash   text NOT NULL DEFAULT '',
  audit_hash  text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bpqs_axis_chk'
  ) THEN
    ALTER TABLE blackboard_post_quality_scores
      ADD CONSTRAINT bpqs_axis_chk
      CHECK (axis IN ('groundedness', 'calibration', 'utility'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bpqs_score_range_chk'
  ) THEN
    ALTER TABLE blackboard_post_quality_scores
      ADD CONSTRAINT bpqs_score_range_chk
      CHECK (score >= 0 AND score <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bpqs_tenant_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_post_quality_scores
      ADD CONSTRAINT bpqs_tenant_nonempty_chk
      CHECK (length(tenant_id) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bpqs_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_post_quality_scores
      ADD CONSTRAINT bpqs_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

-- Hot path: list a tenant's scores for a given post + axis, newest first.
CREATE INDEX IF NOT EXISTS idx_bpqs_post_axis
  ON blackboard_post_quality_scores
  (tenant_id, post_id, axis, scored_at DESC);

-- Forensic replay path — audit-hash lookup.
CREATE INDEX IF NOT EXISTS idx_bpqs_audit_hash
  ON blackboard_post_quality_scores (audit_hash);

-- Tenant-wide newest-first listing for the meta-curator pull.
CREATE INDEX IF NOT EXISTS idx_bpqs_tenant_scored_at
  ON blackboard_post_quality_scores (tenant_id, scored_at DESC);

ALTER TABLE blackboard_post_quality_scores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_post_quality_scores'
       AND policyname = 'bpqs_tenant_isolation'
  ) THEN
    CREATE POLICY bpqs_tenant_isolation
      ON blackboard_post_quality_scores
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. blackboard_search_index — FTS projection over content
-- -----------------------------------------------------------------------------
--
-- Holds a STORED tsvector materialised from blackboard_posts_v2.content.
-- We carry `content` as a NOT NULL text column on this table so the
-- index is self-contained and does not require a join at search time;
-- the application repository writes both `content` and the derived
-- `content_tsvector` (generated) at the same time the post lands on
-- blackboard_posts_v2.
--
-- Why duplicate `content`? Because we control the FTS configuration
-- here (`simple` for now, swappable to `english`/`swahili` per
-- jurisdiction in a follow-up) without touching BLACKBOARD-CORE's
-- schema.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_search_index (
  /** Soft FK to blackboard_posts_v2.id (see header). PK. */
  post_id           uuid PRIMARY KEY,
  tenant_id         text NOT NULL,
  content           text NOT NULL,
  content_tsvector  tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  audit_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bsi_tenant_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_search_index
      ADD CONSTRAINT bsi_tenant_nonempty_chk
      CHECK (length(tenant_id) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bsi_content_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_search_index
      ADD CONSTRAINT bsi_content_nonempty_chk
      CHECK (length(content) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bsi_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE blackboard_search_index
      ADD CONSTRAINT bsi_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

-- Hot path: GIN over the content_tsvector for `@@`-style queries.
CREATE INDEX IF NOT EXISTS idx_bsi_content_tsvector
  ON blackboard_search_index USING gin (content_tsvector);

-- Tenant-scoped lookups by post (the application reads
-- `WHERE tenant_id = $1 AND post_id = $2` to populate result snippets).
CREATE INDEX IF NOT EXISTS idx_bsi_tenant_post
  ON blackboard_search_index (tenant_id, post_id);

ALTER TABLE blackboard_search_index ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blackboard_search_index'
       AND policyname = 'bsi_tenant_isolation'
  ) THEN
    CREATE POLICY bsi_tenant_isolation
      ON blackboard_search_index
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- TODOs once BLACKBOARD-CORE has merged:
--
--   1. ALTER TABLE blackboard_post_quality_scores
--        ADD CONSTRAINT bpqs_post_fk
--        FOREIGN KEY (post_id) REFERENCES blackboard_posts_v2(id)
--        ON DELETE CASCADE;
--
--   2. ALTER TABLE blackboard_search_index
--        ADD CONSTRAINT bsi_post_fk
--        FOREIGN KEY (post_id) REFERENCES blackboard_posts_v2(id)
--        ON DELETE CASCADE;
-- -----------------------------------------------------------------------------

COMMIT;
