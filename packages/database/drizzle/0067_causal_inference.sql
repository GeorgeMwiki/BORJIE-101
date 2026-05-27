-- =============================================================================
-- Migration 0067 — Causal Inference Runs (SOTA-CAUSAL)
--
-- Companion to Docs/DESIGN/CAUSAL_INFERENCE_SOTA_2026.md.
--
-- Mr. Mwikila asks the platform "did the new royalty rate cause filing
-- delays?" or "if we change shift schedule does safety improve?". Each
-- such question runs through the `@borjie/causal-inference` four-step
-- pipeline (model -> identify -> estimate -> refute) and the resulting
-- causal claim — point estimate + 95 % CI + identification strategy —
-- is persisted here for replay and forensic audit.
--
-- One table:
--
--   causal_runs — versioned, tenant-scoped, hash-chained registry of
--                 causal-inference runs. Every row carries an audit
--                 hash chained against the prior row in the tenant's
--                 chain so the analytic record is tamper-evident.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- causal_runs — registry of causal-inference runs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS causal_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  /** Natural-language question Mr. Mwikila asked (e.g. "did the new
      royalty rate cause filing delays?"). */
  question         text NOT NULL,
  /** Column or factor on the cause side of the DAG. */
  treatment        text NOT NULL,
  /** Column or factor on the effect side of the DAG. */
  outcome          text NOT NULL,
  /** Identification strategy used:
      backdoor | frontdoor | did | synthetic-control | rd | granger | pcmci-plus. */
  identification   text NOT NULL,
  /** Point estimate of the causal effect (ATE / lagged-coefficient /
      DiD coefficient depending on identification). */
  effect_estimate  numeric NOT NULL,
  /** Lower bound of the 95 % confidence interval. */
  ci_low           numeric NOT NULL,
  /** Upper bound of the 95 % confidence interval. */
  ci_high          numeric NOT NULL,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  /** Hash of the previous causal-run row in this tenant's chain.
      Empty string for the genesis row. */
  prev_hash        text NOT NULL DEFAULT '',
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_identification_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_identification_chk
      CHECK (identification IN (
        'backdoor','frontdoor','did','synthetic-control','rd',
        'granger','pcmci-plus'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_question_nonempty_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_question_nonempty_chk
      CHECK (length(question) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_treatment_nonempty_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_treatment_nonempty_chk
      CHECK (length(treatment) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_outcome_nonempty_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_outcome_nonempty_chk
      CHECK (length(outcome) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_ci_order_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_ci_order_chk
      CHECK (ci_low <= ci_high);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'causal_runs_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE causal_runs
      ADD CONSTRAINT causal_runs_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

-- Hot path: paginated list of a tenant's causal runs, newest first.
CREATE INDEX IF NOT EXISTS idx_causal_runs_tenant_ran_at
  ON causal_runs (tenant_id, ran_at DESC);

-- Filter by identification strategy when an analyst is auditing
-- specifically DiD or synthetic-control claims.
CREATE INDEX IF NOT EXISTS idx_causal_runs_tenant_identification
  ON causal_runs (tenant_id, identification, ran_at DESC);

-- Forensic replay path.
CREATE INDEX IF NOT EXISTS idx_causal_runs_audit_hash
  ON causal_runs (audit_hash);

ALTER TABLE causal_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'causal_runs'
       AND policyname = 'causal_runs_tenant_isolation'
  ) THEN
    CREATE POLICY causal_runs_tenant_isolation
      ON causal_runs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
