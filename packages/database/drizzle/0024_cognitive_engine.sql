-- =============================================================================
-- Migration 0024 — Cognitive Engine schema (Wave 18T)
--
-- Companion to docs/DESIGN/COGNITIVE_ENGINE_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's reasoning + grounding +
-- adaptive-ingest foundation that sits underneath all 5 atomic
-- capabilities:
--
--   1. cognitive_turns              — one row per kernel turn:
--                                      reasoning trace, path,
--                                      confidence, citations,
--                                      uncertainty notes, audit hash.
--                                      Tenant-scoped.
--   2. ingested_attachments         — owner-uploaded files parsed into
--                                      a DataJoinRef (excel/csv/pdf/
--                                      image/audio). 14-day default
--                                      retention. Tenant-scoped.
--   3. clarifying_question_history  — every clarifying question asked
--                                      + the user's response. Used by
--                                      the scoper to enforce the
--                                      3-question cap per turn.
--                                      Tenant-scoped via turn parent.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. cognitive_turns — per-kernel-turn reasoning + outcome
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cognitive_turns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id          uuid NOT NULL,
  utterance           text NOT NULL,
  reasoning_trace     jsonb NOT NULL,
  path                text NOT NULL,
  artifact_ref        jsonb,
  confidence          text NOT NULL,
  citations           jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty_notes   jsonb,
  cost_usd_cents      integer,
  duration_ms         integer,
  audit_hash          text NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cognitive_turns_confidence_chk
    CHECK (confidence IN ('high','medium','low','refused')),
  CONSTRAINT cognitive_turns_path_chk
    CHECK (path IN (
      'asked_for_clarification',
      'asked_for_data',
      'composed_output',
      'refused_low_confidence'
    ))
);

CREATE INDEX IF NOT EXISTS cognitive_turns_session_recent_idx
  ON cognitive_turns(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cognitive_turns_tenant_recent_idx
  ON cognitive_turns(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cognitive_turns_path_idx
  ON cognitive_turns(path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cognitive_turns_confidence_idx
  ON cognitive_turns(confidence, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cognitive_turns_audit_hash_idx
  ON cognitive_turns(audit_hash);

-- -----------------------------------------------------------------------------
-- 2. ingested_attachments — adaptive-ingest payloads stamped as DataJoinRef
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingested_attachments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id            uuid NOT NULL,
  user_id               text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                  text NOT NULL,
  storage_key           text NOT NULL,
  original_filename     text,
  parsed_columns        jsonb,
  parsed_rows_count     integer,
  pii_redactions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_join_ref         jsonb NOT NULL,
  relevance_to_intent   numeric(3,2),
  retention_until       timestamptz NOT NULL,
  audit_hash            text NOT NULL,
  ingested_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingested_attachments_kind_chk
    CHECK (kind IN ('excel','csv','pdf','image','audio')),
  CONSTRAINT ingested_attachments_rows_chk
    CHECK (parsed_rows_count IS NULL OR parsed_rows_count >= 0),
  CONSTRAINT ingested_attachments_relevance_chk
    CHECK (relevance_to_intent IS NULL
           OR (relevance_to_intent >= 0 AND relevance_to_intent <= 1))
);

CREATE INDEX IF NOT EXISTS ingested_attachments_session_idx
  ON ingested_attachments(session_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS ingested_attachments_tenant_kind_idx
  ON ingested_attachments(tenant_id, kind, ingested_at DESC);
CREATE INDEX IF NOT EXISTS ingested_attachments_retention_idx
  ON ingested_attachments(retention_until);
CREATE INDEX IF NOT EXISTS ingested_attachments_audit_hash_idx
  ON ingested_attachments(audit_hash);

-- -----------------------------------------------------------------------------
-- 3. clarifying_question_history — every question asked + the response
-- -----------------------------------------------------------------------------
-- Used by the scoper to count questions-asked-this-turn against the
-- hard cap of 3 (COGNITIVE_ENGINE_SPEC §6).

CREATE TABLE IF NOT EXISTS clarifying_question_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id             uuid NOT NULL REFERENCES cognitive_turns(id) ON DELETE CASCADE,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question            text NOT NULL,
  possible_answers    jsonb,
  why_needed          text NOT NULL,
  user_response       text,
  asked_at            timestamptz NOT NULL DEFAULT now(),
  answered_at         timestamptz
);

CREATE INDEX IF NOT EXISTS clarifying_question_history_turn_idx
  ON clarifying_question_history(turn_id, asked_at);
CREATE INDEX IF NOT EXISTS clarifying_question_history_tenant_pending_idx
  ON clarifying_question_history(tenant_id, asked_at DESC)
  WHERE answered_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. Row Level Security — all three tables tenant-scoped
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cognitive_turns',
    'ingested_attachments',
    'clarifying_question_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0024_cognitive_engine.sql
-- =============================================================================
