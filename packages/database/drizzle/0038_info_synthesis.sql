-- =============================================================================
-- Migration 0038 — Information Synthesis SOTA (Wave M7)
--
-- Companion to Docs/DESIGN/INFORMATION_SYNTHESIS_SOTA_SPEC.md.
--
-- Adds the persistence substrate for Mr. Mwikila's diorize pipeline:
-- given a corpus of artifacts (journal entries, research results,
-- tacit-knowledge transcripts, ingested documents), the synthesizer
-- runs a multi-stage pipeline — chunk → score → cluster → reconcile
-- → write → cite → calibrate — and emits a calibrated, multi-
-- perspective synthesis with citations, disagreements, and confidence.
--
-- Two tables:
--
--   1. synth_runs    — one row per synthesizer invocation. Stores the
--                      query, corpus identifiers (artifact IDs), start
--                      and end timestamps, status, and audit hash chain
--                      pointers. Tenant-scoped, RLS-bound.
--
--   2. synth_outputs — one row per synthesis output produced by a run.
--                      A run usually produces one output, but the
--                      multi-perspective option can emit several
--                      (one per perspective).  Stores the text, the
--                      structured citations (jsonb), the calibrated
--                      confidence (0..1 real), the detected
--                      disagreements (jsonb), and the audit hash.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. synth_runs — pipeline invocation ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS synth_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  query        text NOT NULL,
  corpus_ids   text[] NOT NULL DEFAULT ARRAY[]::text[],
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  status       text NOT NULL DEFAULT 'pending',
  audit_hash   text NOT NULL,
  prev_hash    text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'synth_runs_status_chk'
  ) THEN
    ALTER TABLE synth_runs
      ADD CONSTRAINT synth_runs_status_chk
      CHECK (status IN ('pending', 'running', 'succeeded', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_synth_runs_tenant_recent
  ON synth_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_synth_runs_status
  ON synth_runs (tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_synth_runs_audit_hash
  ON synth_runs (audit_hash);

ALTER TABLE synth_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'synth_runs'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON synth_runs
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. synth_outputs — one row per synthesis emitted by a run
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS synth_outputs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  synth_run_id            uuid NOT NULL REFERENCES synth_runs(id) ON DELETE CASCADE,
  tenant_id               text NOT NULL,
  output                  text NOT NULL,
  citations               jsonb NOT NULL DEFAULT '[]'::jsonb,
  calibrated_confidence   real NOT NULL DEFAULT 0,
  disagreements           jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_hash              text NOT NULL,
  emitted_at              timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'synth_outputs_confidence_chk'
  ) THEN
    ALTER TABLE synth_outputs
      ADD CONSTRAINT synth_outputs_confidence_chk
      CHECK (calibrated_confidence >= 0 AND calibrated_confidence <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_synth_outputs_run
  ON synth_outputs (synth_run_id, emitted_at);

CREATE INDEX IF NOT EXISTS idx_synth_outputs_tenant_recent
  ON synth_outputs (tenant_id, emitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_synth_outputs_audit_hash
  ON synth_outputs (audit_hash);

ALTER TABLE synth_outputs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'synth_outputs'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON synth_outputs
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
