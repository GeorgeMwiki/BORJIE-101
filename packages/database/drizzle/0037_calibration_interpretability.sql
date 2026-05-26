-- =============================================================================
-- Migration 0037 — Calibration + Interpretability schema (Wave 18BB-gap)
--
-- Companion to Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md. Closes
-- founder directive P0 #5 (Constitutional-AI parity). Adds three tables
-- forming the continuous calibration loop + the mechanistic
-- interpretability persistence layer over Mr. Mwikila's Tier-1+
-- predictions and hidden activations:
--
--   1. calibration_observations
--        — one row per Tier-1+ prediction at decision time. The
--          outcome_* + resolved_at columns are filled in later by
--          the outcome-resolver (owner approve/reject, real-world
--          outcome, manual ground-truth backfill). The triple
--          (tenant_id, prediction_kind, entity_id) is unique so a
--          repeat observe is idempotent. Tenant-scoped, RLS-bound.
--   2. calibration_weekly_reports
--        — one row per (tenant, prediction_kind, period). Generated
--          on cron Sunday 02:00 UTC by weekly-report-generator.
--          Stores brier_score, ece, sample_size, plus the full
--          reliability diagram as jsonb. Tenant-scoped, RLS-bound.
--   3. sae_probe_features
--        — one row per fired SAE feature per probe call. Stores
--          (feature_id, feature_label, category, activation_strength,
--          threshold_at_time, session_id, turn_id). Tenant-scoped,
--          RLS-bound. The seven sensitive categories tracked are
--          deception, hallucination, bias, sycophancy, prompt_injection,
--          self_reference, confidentiality_leak.
--
-- All three tables write through the audit hash chain.
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. calibration_observations — observe → resolve store
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calibration_observations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  prediction_kind         text NOT NULL,
  entity_id               text NOT NULL,
  predicted_confidence    numeric(4,3) NOT NULL,
  predicted_label         text NOT NULL,
  outcome_label           text,
  outcome_value           smallint,
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash              text NOT NULL,
  CONSTRAINT calibration_confidence_range CHECK (
    predicted_confidence >= 0 AND predicted_confidence <= 1
  ),
  CONSTRAINT calibration_outcome_binary CHECK (
    outcome_value IS NULL OR outcome_value IN (0, 1)
  ),
  CONSTRAINT calibration_observation_unique_triple UNIQUE (
    tenant_id, prediction_kind, entity_id
  )
);

CREATE INDEX IF NOT EXISTS idx_calobs_tenant_kind_resolved
  ON calibration_observations (tenant_id, prediction_kind, resolved_at);
CREATE INDEX IF NOT EXISTS idx_calobs_tenant_created
  ON calibration_observations (tenant_id, created_at DESC);

ALTER TABLE calibration_observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'calibration_observations'
       AND policyname = 'calibration_observations_tenant_isolation'
  ) THEN
    CREATE POLICY calibration_observations_tenant_isolation
      ON calibration_observations
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. calibration_weekly_reports — Brier + ECE + reliability diagram
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calibration_weekly_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL,
  prediction_kind          text NOT NULL,
  report_period_start      timestamptz NOT NULL,
  report_period_end        timestamptz NOT NULL,
  sample_size              integer NOT NULL,
  brier_score              numeric(6,5) NOT NULL,
  ece                      numeric(6,5) NOT NULL,
  reliability_diagram      jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at             timestamptz NOT NULL DEFAULT now(),
  audit_hash               text NOT NULL,
  CONSTRAINT calreport_window_well_formed CHECK (
    report_period_end > report_period_start
  ),
  CONSTRAINT calreport_sample_positive CHECK (sample_size > 0),
  CONSTRAINT calreport_brier_range CHECK (
    brier_score >= 0 AND brier_score <= 1
  ),
  CONSTRAINT calreport_ece_range CHECK (ece >= 0 AND ece <= 1)
);

CREATE INDEX IF NOT EXISTS idx_calreport_tenant_kind_period
  ON calibration_weekly_reports (
    tenant_id, prediction_kind, report_period_start DESC
  );
CREATE INDEX IF NOT EXISTS idx_calreport_tenant_generated
  ON calibration_weekly_reports (tenant_id, generated_at DESC);

ALTER TABLE calibration_weekly_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'calibration_weekly_reports'
       AND policyname = 'calibration_weekly_reports_tenant_isolation'
  ) THEN
    CREATE POLICY calibration_weekly_reports_tenant_isolation
      ON calibration_weekly_reports
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. sae_probe_features — SAE runtime firing log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sae_probe_features (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL,
  session_id               text NOT NULL,
  turn_id                  text NOT NULL,
  feature_id               text NOT NULL,
  feature_label            text NOT NULL,
  category                 text NOT NULL,
  activation_strength      numeric(10,6) NOT NULL,
  threshold_at_time        numeric(10,6) NOT NULL,
  detected_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash               text NOT NULL,
  CONSTRAINT sae_feature_category_chk CHECK (category IN (
    'deception',
    'hallucination',
    'bias',
    'sycophancy',
    'prompt_injection',
    'self_reference',
    'confidentiality_leak'
  )),
  CONSTRAINT sae_strength_non_negative CHECK (activation_strength >= 0),
  CONSTRAINT sae_threshold_non_negative CHECK (threshold_at_time >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sae_tenant_feature_recent
  ON sae_probe_features (tenant_id, feature_label, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sae_tenant_session
  ON sae_probe_features (tenant_id, session_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_sae_tenant_category_recent
  ON sae_probe_features (tenant_id, category, detected_at DESC);

ALTER TABLE sae_probe_features ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'sae_probe_features'
       AND policyname = 'sae_probe_features_tenant_isolation'
  ) THEN
    CREATE POLICY sae_probe_features_tenant_isolation ON sae_probe_features
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
