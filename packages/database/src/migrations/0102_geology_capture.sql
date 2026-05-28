-- =============================================================================
-- Migration 0102 - Geology drill-hole capture pipeline (mining-domain backend).
--
-- Adds the strict drill-hole / interval / assay lifecycle used by the
-- workforce-mobile geologist screen and the chat-as-OS brain tools
-- (`mining.geology.log_drill_hole`). Distinct from the legacy
-- `drill_holes` / `drill_hole_layers` tables (migration 0003) which are
-- coarse logging-only surfaces; the new tables carry interval-level
-- mineralisation_pct, mineral assemblages, structural features, photo
-- references, sample IDs, lab party IDs, QA/QC flags, and hash-chained
-- audit pointers required by the geology pipeline.
--
-- Tables:
--   * drill_holes            - hole header (status enum, geologist, lat/lng)
--   * drill_hole_intervals   - per-interval lithology / mineralisation log
--   * assay_results          - lab return per sample (au_gpt / ag_gpt / cu_pct)
--
-- Tenant-scoping is enforced via the canonical
-- `current_setting('app.current_tenant_id', true)` GUC RLS predicate.
-- RLS is FORCE-enabled per the Borjie hard rule (CLAUDE.md).
-- Idempotent (IF NOT EXISTS + DO blocks). Forward-only - never edit.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- drill_holes - geology drill-hole header.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS drill_holes_geology (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  site_id         uuid        NOT NULL,
  hole_number     text        NOT NULL,
  lat             numeric(10, 6),
  lng             numeric(10, 6),
  depth_m         numeric(8, 2),
  started_at      timestamptz,
  completed_at    timestamptz,
  geologist_id    uuid,
  status          text        NOT NULL DEFAULT 'planned',
  provenance      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drill_holes_geology_status_chk'
  ) THEN
    ALTER TABLE drill_holes_geology
      ADD CONSTRAINT drill_holes_geology_status_chk
      CHECK (status IN ('planned', 'in_progress', 'completed', 'abandoned'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'drill_holes_geology_tenant_hole_uq'
  ) THEN
    ALTER TABLE drill_holes_geology
      ADD CONSTRAINT drill_holes_geology_tenant_hole_uq
      UNIQUE (tenant_id, site_id, hole_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drill_holes_geology_tenant_site
  ON drill_holes_geology (tenant_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drill_holes_geology_tenant_status
  ON drill_holes_geology (tenant_id, status);

ALTER TABLE drill_holes_geology ENABLE ROW LEVEL SECURITY;
ALTER TABLE drill_holes_geology FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'drill_holes_geology'
       AND policyname = 'drill_holes_geology_tenant_isolation'
  ) THEN
    CREATE POLICY drill_holes_geology_tenant_isolation
      ON drill_holes_geology
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- drill_hole_intervals - per-interval lithology / mineralisation log.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS drill_hole_intervals (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_hole_id         uuid        NOT NULL REFERENCES drill_holes_geology(id) ON DELETE CASCADE,
  tenant_id             uuid        NOT NULL,
  from_m                numeric(8, 2) NOT NULL,
  to_m                  numeric(8, 2) NOT NULL,
  lithology             text,
  alteration            text,
  mineralisation_pct    numeric(5, 2),
  mineral_assemblage    text[]      NOT NULL DEFAULT ARRAY[]::text[],
  structural_features   text,
  log_photo_ids         uuid[]      NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drill_hole_intervals_depth_chk'
  ) THEN
    ALTER TABLE drill_hole_intervals
      ADD CONSTRAINT drill_hole_intervals_depth_chk
      CHECK (to_m > from_m);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drill_hole_intervals_mpct_chk'
  ) THEN
    ALTER TABLE drill_hole_intervals
      ADD CONSTRAINT drill_hole_intervals_mpct_chk
      CHECK (mineralisation_pct IS NULL OR (mineralisation_pct >= 0 AND mineralisation_pct <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drill_hole_intervals_tenant_hole
  ON drill_hole_intervals (tenant_id, drill_hole_id, from_m);

ALTER TABLE drill_hole_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE drill_hole_intervals FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'drill_hole_intervals'
       AND policyname = 'drill_hole_intervals_tenant_isolation'
  ) THEN
    CREATE POLICY drill_hole_intervals_tenant_isolation
      ON drill_hole_intervals
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- assay_results - lab return per sample.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assay_results (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  drill_hole_id     uuid        NOT NULL REFERENCES drill_holes_geology(id) ON DELETE CASCADE,
  interval_id       uuid        REFERENCES drill_hole_intervals(id) ON DELETE SET NULL,
  sample_id         text        NOT NULL,
  lab_party_id      uuid,
  sent_at           timestamptz,
  received_at       timestamptz,
  au_gpt            numeric(10, 4),
  ag_gpt            numeric(10, 4),
  cu_pct            numeric(8, 4),
  qa_qc_pass        boolean     NOT NULL DEFAULT false,
  evidence_doc_id   uuid,
  audit_hash_id     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assay_results_tenant_sample_uq'
  ) THEN
    ALTER TABLE assay_results
      ADD CONSTRAINT assay_results_tenant_sample_uq
      UNIQUE (tenant_id, sample_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assay_results_tenant_hole
  ON assay_results (tenant_id, drill_hole_id);

CREATE INDEX IF NOT EXISTS idx_assay_results_tenant_received
  ON assay_results (tenant_id, received_at DESC);

ALTER TABLE assay_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE assay_results FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'assay_results'
       AND policyname = 'assay_results_tenant_isolation'
  ) THEN
    CREATE POLICY assay_results_tenant_isolation
      ON assay_results
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
