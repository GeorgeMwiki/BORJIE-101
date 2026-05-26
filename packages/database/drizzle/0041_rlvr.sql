-- =============================================================================
-- Migration 0041 — RLVR Post-Training Pipeline (Wave 19C)
--
-- Spec: Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md
--
-- Adds the orchestration substrate for Reinforcement Learning from Verifiable
-- Rewards. Mr. Mwikila session traces are captured, verified through a
-- catalogue of verifiers (TRA schema, royalty math, citation resolve,
-- brand-lock, calibration, mutation-authority, ...), scored with a binary
-- + shaped reward, curated/deduped/redacted, and ultimately handed off to
-- a fine-tuning provider (Anthropic, OpenAI, Together).
--
-- Four tables:
--   1. rlvr_runs               — one row per end-to-end RLVR pipeline run.
--                                 Carries `verifier_set` + lifecycle status +
--                                 PO-14 hash chain.
--   2. rlvr_traces             — captured Mr. Mwikila traces. Stores both the
--                                 raw trace and the redacted (salted-hash)
--                                 trace; only the redacted form is allowed
--                                 to leave the tenant boundary.
--   3. rlvr_verifications      — per-(trace, verifier) verdict. Verdict in
--                                 ('pass','fail','partial','skip').
--   4. rlvr_curated_examples   — post-curation training examples. Carries the
--                                 (prompt, completion, reward) tuple plus
--                                 `included` + `exclusion_reason` so dropped
--                                 traces are auditable.
--
-- All four tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from migration
-- 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. rlvr_runs — one row per end-to-end RLVR pipeline run
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rlvr_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  kind                text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  status              text NOT NULL DEFAULT 'pending',
  verifier_set        text[] NOT NULL DEFAULT '{}',
  audit_hash          text NOT NULL,
  prev_hash           text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_runs_status_chk'
  ) THEN
    ALTER TABLE rlvr_runs
      ADD CONSTRAINT rlvr_runs_status_chk
      CHECK (status IN (
        'pending', 'running', 'verifying', 'curating',
        'redacting', 'ready_for_handoff', 'handed_off',
        'completed', 'cancelled', 'failed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_runs_kind_chk'
  ) THEN
    ALTER TABLE rlvr_runs
      ADD CONSTRAINT rlvr_runs_kind_chk
      CHECK (kind IN (
        'tra_filings', 'royalty_audits', 'brand_compliance',
        'citation_grounding', 'mixed', 'synthetic_test'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rlvr_runs_tenant
  ON rlvr_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_rlvr_runs_status
  ON rlvr_runs (tenant_id, status, started_at DESC);

ALTER TABLE rlvr_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rlvr_runs_tenant_read ON rlvr_runs;
CREATE POLICY rlvr_runs_tenant_read ON rlvr_runs
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE rlvr_runs IS
  'Wave 19C — RLVR post-training pipeline run. Carries verifier_set + lifecycle status + PO-14 hash chain. See Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md.';

-- -----------------------------------------------------------------------------
-- 2. rlvr_traces — captured Mr. Mwikila traces
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rlvr_traces (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rlvr_run_id              uuid NOT NULL REFERENCES rlvr_runs(id) ON DELETE CASCADE,
  tenant_id                text NOT NULL,
  trace                    jsonb NOT NULL,
  tenant_redacted_trace    jsonb,
  captured_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash               text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rlvr_traces_run
  ON rlvr_traces (rlvr_run_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_rlvr_traces_tenant
  ON rlvr_traces (tenant_id, captured_at DESC);

ALTER TABLE rlvr_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rlvr_traces_tenant_read ON rlvr_traces;
CREATE POLICY rlvr_traces_tenant_read ON rlvr_traces
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE rlvr_traces IS
  'Wave 19C — captured Mr. Mwikila trace. `trace` is raw; `tenant_redacted_trace` is salted-hashed (sha256(tenant_id:fieldPath:value)) and is the only form permitted to leave the tenant boundary.';

-- -----------------------------------------------------------------------------
-- 3. rlvr_verifications — per-(trace, verifier) verdict
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rlvr_verifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rlvr_trace_id   uuid NOT NULL REFERENCES rlvr_traces(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  verifier_name   text NOT NULL,
  verdict         text NOT NULL,
  reward          real NOT NULL DEFAULT 0,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_verifications_verdict_chk'
  ) THEN
    ALTER TABLE rlvr_verifications
      ADD CONSTRAINT rlvr_verifications_verdict_chk
      CHECK (verdict IN ('pass', 'fail', 'partial', 'skip'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_verifications_reward_chk'
  ) THEN
    ALTER TABLE rlvr_verifications
      ADD CONSTRAINT rlvr_verifications_reward_chk
      CHECK (reward >= 0 AND reward <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rlvr_verifications_trace
  ON rlvr_verifications (rlvr_trace_id, verifier_name);

CREATE INDEX IF NOT EXISTS idx_rlvr_verifications_verdict
  ON rlvr_verifications (tenant_id, verdict, verified_at DESC);

ALTER TABLE rlvr_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rlvr_verifications_tenant_read ON rlvr_verifications;
CREATE POLICY rlvr_verifications_tenant_read ON rlvr_verifications
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE rlvr_verifications IS
  'Wave 19C — per-(trace, verifier) verdict. Verdict in (pass, fail, partial, skip). Reward clamped to [0,1].';

-- -----------------------------------------------------------------------------
-- 4. rlvr_curated_examples — post-curation training examples
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rlvr_curated_examples (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rlvr_run_id       uuid NOT NULL REFERENCES rlvr_runs(id) ON DELETE CASCADE,
  rlvr_trace_id     uuid REFERENCES rlvr_traces(id) ON DELETE SET NULL,
  tenant_id         text NOT NULL,
  prompt            jsonb NOT NULL,
  completion        jsonb NOT NULL,
  reward            real NOT NULL DEFAULT 0,
  included          boolean NOT NULL DEFAULT false,
  exclusion_reason  text,
  curated_at        timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_curated_reward_chk'
  ) THEN
    ALTER TABLE rlvr_curated_examples
      ADD CONSTRAINT rlvr_curated_reward_chk
      CHECK (reward >= 0 AND reward <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rlvr_curated_inclusion_chk'
  ) THEN
    ALTER TABLE rlvr_curated_examples
      ADD CONSTRAINT rlvr_curated_inclusion_chk
      CHECK (
        (included = true AND exclusion_reason IS NULL) OR
        (included = false AND exclusion_reason IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rlvr_curated_run
  ON rlvr_curated_examples (rlvr_run_id, included, curated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rlvr_curated_tenant
  ON rlvr_curated_examples (tenant_id, included, curated_at DESC);

ALTER TABLE rlvr_curated_examples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rlvr_curated_tenant_read ON rlvr_curated_examples;
CREATE POLICY rlvr_curated_tenant_read ON rlvr_curated_examples
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE rlvr_curated_examples IS
  'Wave 19C — post-curation training example. (prompt, completion, reward) + included/exclusion_reason. Mutually exclusive: if included=true then exclusion_reason IS NULL, and vice versa.';

COMMIT;
