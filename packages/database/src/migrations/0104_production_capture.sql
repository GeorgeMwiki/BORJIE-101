-- =============================================================================
-- Migration 0104 - Production tonnage capture.
--
-- Wave PRODUCTION-CAPTURE. Records each tonnage capture event with
-- ore / waste split, strip ratio, source attribution (field app, plant
-- scale, manual entry), photo evidence, and a QA sign-off lane.
-- Distinct from legacy `production_records` (migration 0003) which is
-- coarse kg-output logging. This new table powers the supervisor sign-
-- off flow + the site-cockpit tonnage panel + the chat brain tools
-- (`mining.production.log_tonnage`, `daily_summary`, `qa_backlog`).
--
-- Tables:
--   * production_tonnage_events
--
-- Tenant scope:
--   tenant_id::text = current_setting('app.current_tenant_id', true)
--
-- RLS FORCE-enabled per CLAUDE.md. Idempotent. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS production_tonnage_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  shift_id            uuid,
  recorded_by_id      uuid        NOT NULL,
  ore_tonnes          numeric(12, 3) NOT NULL,
  waste_tonnes        numeric(12, 3) NOT NULL DEFAULT 0,
  strip_ratio         numeric(8, 3),
  captured_at         timestamptz NOT NULL DEFAULT now(),
  source              text        NOT NULL,
  evidence_photo_ids  uuid[]      NOT NULL DEFAULT ARRAY[]::uuid[],
  qa_status           text        NOT NULL DEFAULT 'pending',
  qa_passed_at        timestamptz,
  qa_passed_by        uuid,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_tonnage_events_source_chk'
  ) THEN
    ALTER TABLE production_tonnage_events
      ADD CONSTRAINT production_tonnage_events_source_chk
      CHECK (source IN ('field_app', 'plant_scale', 'manual_entry'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_tonnage_events_qa_chk'
  ) THEN
    ALTER TABLE production_tonnage_events
      ADD CONSTRAINT production_tonnage_events_qa_chk
      CHECK (qa_status IN ('pending', 'passed', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_tonnage_events_ore_chk'
  ) THEN
    ALTER TABLE production_tonnage_events
      ADD CONSTRAINT production_tonnage_events_ore_chk
      CHECK (ore_tonnes >= 0 AND waste_tonnes >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS production_tonnage_events_tenant_site_day
  ON production_tonnage_events (tenant_id, site_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS production_tonnage_events_tenant_qa_pending
  ON production_tonnage_events (tenant_id, qa_status)
  WHERE qa_status = 'pending';

ALTER TABLE production_tonnage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_tonnage_events FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'production_tonnage_events'
       AND policyname = 'production_tonnage_events_tenant_isolation'
  ) THEN
    CREATE POLICY production_tonnage_events_tenant_isolation
      ON production_tonnage_events
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
