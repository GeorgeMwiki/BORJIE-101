-- =============================================================================
-- Migration 0044 — Tacit Knowledge Harvest schema (Wave HARVEST)
--
-- Companion to Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md. Adds the
-- persistence substrate for the 5-mode tacit-knowledge interview engine
-- (`@borjie/tacit-knowledge`). Three tables:
--
--   1. tacit_interviews   — one row per session. subject_user_id is the
--                            person being interviewed (never named
--                            "interviewee" in UI). interviewer defaults
--                            to 'mr-mwikila'. mode is one of five values.
--                            transcript is jsonb carrying ordered turns.
--                            location_geog is the session anchor.
--                            Tenant-scoped, RLS-bound.
--   2. tacit_extractions  — one row per extracted know-how artifact.
--                            Links to interview_id. Carries entity_kind,
--                            entity (jsonb), confidence, novel,
--                            redundant_with_cell_id (filled by
--                            redundancy checker), persisted_cell_id
--                            (filled once cell is written into cognitive
--                            memory via the host-wired port).
--                            Tenant-scoped (inherits via FK).
--   3. tacit_consents     — one row per (subject, tenant). Default
--                            status = 'granted'. revoked_at set on
--                            revoke. PK = (subject_user_id, tenant_id).
--                            Tenant-scoped, RLS-bound.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- 1. tacit_interviews — one row per harvest session
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tacit_interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  -- the person whose tacit knowledge is being harvested. Mining roles
  -- vary; the column is role-agnostic by design.
  subject_user_id    uuid NOT NULL,
  -- always 'mr-mwikila' by default; left mutable for future co-interviewers.
  interviewer        text NOT NULL DEFAULT 'mr-mwikila',
  -- one of the five mode shapes defined in TACIT_KNOWLEDGE_HARVEST_SPEC.md.
  mode               text NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  -- 'running' | 'ended_ok' | 'ended_revoked' | 'ended_error'
  status             text NOT NULL DEFAULT 'running',
  -- ordered turns: [{ speaker, text, at, gps?: {lat,lng} }, ...]
  transcript         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- session anchor (where the walk-the-floor happened, vehicle origin
  -- for ride-along, etc.). Null for deal-replay or cross-role sessions
  -- with no canonical location.
  location_geog      geography(POINT, 4326),
  audit_hash         text NOT NULL,
  prev_hash          text NOT NULL,
  CONSTRAINT ti_mode_known CHECK (mode IN (
    'walk-the-floor','post-incident','ride-along','deal-replay','cross-role'
  )),
  CONSTRAINT ti_status_known CHECK (status IN (
    'running','ended_ok','ended_revoked','ended_error'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ti_tenant_subject
  ON tacit_interviews (tenant_id, subject_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_tenant_mode
  ON tacit_interviews (tenant_id, mode, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_status
  ON tacit_interviews (tenant_id, status, started_at DESC);

ALTER TABLE tacit_interviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tacit_interviews'
       AND policyname = 'ti_tenant_isolation'
  ) THEN
    CREATE POLICY ti_tenant_isolation ON tacit_interviews
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. tacit_extractions — one row per extracted know-how artifact
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tacit_extractions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id            uuid NOT NULL REFERENCES tacit_interviews(id) ON DELETE CASCADE,
  tenant_id               text NOT NULL,
  -- maps to one of the eight cognitive-memory MemoryKinds.
  entity_kind             text NOT NULL,
  -- the extracted payload itself — text, structured fields, citations.
  entity                  jsonb NOT NULL,
  confidence              real NOT NULL,
  -- extractor's own claim. The redundancy checker may flip it to false.
  novel                   boolean NOT NULL DEFAULT TRUE,
  -- set by the redundancy checker when an existing cell already exists.
  redundant_with_cell_id  uuid,
  -- set by the cell-writer once persistence into cognitive-memory succeeds.
  persisted_cell_id       uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash              text NOT NULL,
  CONSTRAINT te_kind_known CHECK (entity_kind IN (
    'pattern','fact','rule','preference','template','citation','failure','terminology'
  )),
  CONSTRAINT te_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_te_interview
  ON tacit_extractions (interview_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_te_tenant_kind
  ON tacit_extractions (tenant_id, entity_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_te_persisted
  ON tacit_extractions (tenant_id, persisted_cell_id)
  WHERE persisted_cell_id IS NOT NULL;

ALTER TABLE tacit_extractions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tacit_extractions'
       AND policyname = 'te_tenant_isolation'
  ) THEN
    CREATE POLICY te_tenant_isolation ON tacit_extractions
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. tacit_consents — one row per (subject, tenant)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tacit_consents (
  subject_user_id   uuid NOT NULL,
  tenant_id         text NOT NULL,
  status            text NOT NULL DEFAULT 'granted',
  granted_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  audit_hash        text NOT NULL,
  PRIMARY KEY (subject_user_id, tenant_id),
  CONSTRAINT tc_status_known CHECK (status IN ('granted','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_tc_tenant_status
  ON tacit_consents (tenant_id, status);

ALTER TABLE tacit_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tacit_consents'
       AND policyname = 'tc_tenant_isolation'
  ) THEN
    CREATE POLICY tc_tenant_isolation ON tacit_consents
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
