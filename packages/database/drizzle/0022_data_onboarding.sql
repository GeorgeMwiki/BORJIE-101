-- =============================================================================
-- Migration 0022 — Data Onboarding (Wave 18U)
--
-- Companion to docs/DESIGN/DATA_ONBOARDING_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's 7-stage data-onboarding
-- pipeline. Owner uploads a tabular file; the MD recognises the
-- entity type, discovers the file's schema, matches it against the
-- tenant's existing tables, proposes schema evolutions (Tier-2 via
-- mutation-authority), persists rows with provenance, builds a
-- profile-chain graph, and enriches rows via deep online research.
--
--   1. data_onboarding_sessions       — one row per onboarding
--                                        session. Tenant-scoped.
--   2. data_onboarding_row_provenance — one row per persisted DB
--                                        row, binding it back to the
--                                        source file + sheet + row
--                                        number. Tenant-scoped.
--
-- Schema-evolution proposals themselves live in the existing
-- mutation-authority-owned proposals tables — no duplication.
-- Audit links flow through the existing `ai_audit_chain` table; both
-- new tables persist the audit_hash inline for forward-compat with
-- any future per-domain audit shard.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern (migration 0003).
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. data_onboarding_sessions
-- -----------------------------------------------------------------------------
-- One row per owner-initiated onboarding session. The seven JSONB
-- payload columns are intentionally permissive — the canonical TS
-- shape is enforced upstream by the @borjie/data-onboarding package;
-- the DB just stores the result of each completed stage so that
-- async resumption and async owner-approval round-trips work.

CREATE TABLE IF NOT EXISTS data_onboarding_sessions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL,
  user_id                  text NOT NULL,
  attachment_id            uuid NOT NULL,
  inferred_entity_type     text NOT NULL,
  entity_confidence        numeric(3,2) NOT NULL,
  status                   text NOT NULL DEFAULT 'discovering',
  discovered_schema        jsonb,
  schema_match_result      jsonb,
  evolution_proposals      jsonb,
  persist_result           jsonb,
  profile_chain_graph      jsonb,
  enrichment_result        jsonb,
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  CONSTRAINT data_onboarding_sessions_status_chk
    CHECK (status IN (
      'discovering','matching','proposing','awaiting_owner',
      'persisting','enriching','complete','failed'
    )),
  CONSTRAINT data_onboarding_sessions_confidence_chk
    CHECK (entity_confidence >= 0 AND entity_confidence <= 1)
);

CREATE INDEX IF NOT EXISTS data_onboarding_sessions_tenant_idx
  ON data_onboarding_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS data_onboarding_sessions_status_idx
  ON data_onboarding_sessions(status);
CREATE INDEX IF NOT EXISTS data_onboarding_sessions_started_idx
  ON data_onboarding_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS data_onboarding_sessions_entity_type_idx
  ON data_onboarding_sessions(inferred_entity_type);
CREATE INDEX IF NOT EXISTS data_onboarding_sessions_attachment_idx
  ON data_onboarding_sessions(attachment_id);

ALTER TABLE data_onboarding_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'data_onboarding_sessions'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON data_onboarding_sessions '
      || 'USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. data_onboarding_row_provenance
-- -----------------------------------------------------------------------------
-- One row per persisted DB row. Binds an actual target table + row
-- id back to the original source file + sheet + row number, with the
-- audit_hash of the insert/update operation. This lets the owner ask
-- "where did this worker's NIDA come from?" and get the exact cell.

CREATE TABLE IF NOT EXISTS data_onboarding_row_provenance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  target_table        text NOT NULL,
  target_row_id       text NOT NULL,
  source_session_id   uuid NOT NULL REFERENCES data_onboarding_sessions(id)
                              ON DELETE CASCADE,
  source_file_name    text,
  source_sheet        text,
  source_row_number   integer NOT NULL,
  operation           text NOT NULL,
  audit_hash          text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_onboarding_row_provenance_operation_chk
    CHECK (operation IN ('insert','update','skip'))
);

CREATE INDEX IF NOT EXISTS data_onboarding_row_provenance_tenant_idx
  ON data_onboarding_row_provenance(tenant_id);
CREATE INDEX IF NOT EXISTS data_onboarding_row_provenance_target_idx
  ON data_onboarding_row_provenance(target_table, target_row_id);
CREATE INDEX IF NOT EXISTS data_onboarding_row_provenance_session_idx
  ON data_onboarding_row_provenance(source_session_id);
CREATE INDEX IF NOT EXISTS data_onboarding_row_provenance_recorded_idx
  ON data_onboarding_row_provenance(recorded_at DESC);

ALTER TABLE data_onboarding_row_provenance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'data_onboarding_row_provenance'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON data_onboarding_row_provenance '
      || 'USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

COMMIT;
