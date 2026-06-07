-- =============================================================================
-- Migration 0299 — conformal_calibration (online ACI coverage-feedback loop).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The `@borjie/conformal-calibration-online` package is a PURE Adaptive
-- Conformal Inference (ACI, Gibbs & Candès 2021) state machine: it adapts a
-- prediction-interval rejection rate (alpha) to the OBSERVED coverage as real
-- outcomes arrive. A pure state machine is dark until something (a) persists the
-- predictions it emits, (b) records whether each real outcome fell inside the
-- predicted interval, and (c) persists the rolling ACI state so alpha survives
-- restarts and accrues across observations. This migration stands up the three
-- durable tables that turn the package into a REAL feedback loop:
--
--   conformal_predictions       — one row per emitted prediction + its interval.
--   conformal_observations      — one row per landed outcome (covered or not).
--   conformal_calibration_state — one row per (tenant, prediction_type): the
--                                 persisted ACI state (alpha + rolling window).
--
-- The calibrated alpha is then fed back into the brain's CONFIDENCE path
-- (cognitive-engine confidence-calibrator) where it SHIFTS the high/medium/low
-- thresholds: a lower alpha (intervals must be wider to hit target coverage →
-- the model is under-covering → be MORE cautious) tightens the thresholds; a
-- higher alpha relaxes them. Until observations accrue for a prediction type the
-- default alpha is used (honest cold-start, not a fake constant).
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0289 / 0292):
--   tenant_id is TEXT and FK→tenants; every table FORCE-enables ROW LEVEL
--   SECURITY with a tenant policy on the canonical `app.current_tenant_id` GUC.
--   Bare compare (no cast) because tenant_id is already TEXT. NEVER the legacy
--   app.tenant_id GUC.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): nothing here is a money column. A
-- predicted interval / observed value is a domain-neutral double (e.g. a
-- coverage probability, a forecast quantity). Any monetary fact a prediction is
-- ABOUT lives in the free-form `metadata` jsonb exactly as produced (minor-units
-- + currency), never a typed money column and never a currency literal.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule). Every object uses CREATE
-- TABLE IF NOT EXISTS / guarded DO-blocks / CREATE INDEX IF NOT EXISTS, and a
-- pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a pure
-- no-op. References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/conformal-calibration.schema.ts
--   * services/api-gateway/src/composition/conformal/drizzle-conformal-store.ts
--   * services/api-gateway/src/composition/conformal/conformal-calibration-loop.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- conformal_predictions — one row per emitted prediction + its interval.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conformal_predictions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Caller-stable id of the upstream prediction (e.g. PredictionEngine's
  -- PredictionId). Unique per tenant so an outcome can be matched back exactly.
  prediction_id      text        NOT NULL,
  -- Which model family emitted this (royalty_arrears_risk, buyer_churn_risk,
  -- maintenance_recurrence, production_health, forecast, confidence, ...). Drives
  -- the (tenant, prediction_type) ACI state row used to calibrate alpha.
  prediction_type    text        NOT NULL,
  -- The predicted point estimate (domain-neutral double).
  predicted_value    double precision,
  -- The predicted interval [lower, upper] at emit time. NULL upper/lower means
  -- one-sided / unbounded on that side.
  predicted_lower    double precision,
  predicted_upper    double precision,
  -- The alpha (rejection rate) in force when this interval was produced — the
  -- value `currentAlpha(state)` returned, so the loop is auditable end-to-end.
  alpha_at_emit      double precision NOT NULL,
  -- Free-form facts the prediction was about (minor-units + currency live here,
  -- never a typed money column).
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  predicted_at       timestamptz NOT NULL DEFAULT now(),
  created_by         text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_predictions_alpha_chk'
  ) THEN
    ALTER TABLE conformal_predictions
      ADD CONSTRAINT conformal_predictions_alpha_chk
      CHECK (alpha_at_emit BETWEEN 0 AND 1);
  END IF;

  -- One persisted prediction per (tenant, prediction_id) so an outcome maps 1:1.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_predictions_tenant_prediction_uq'
  ) THEN
    ALTER TABLE conformal_predictions
      ADD CONSTRAINT conformal_predictions_tenant_prediction_uq
      UNIQUE (tenant_id, prediction_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conformal_predictions_tenant_type_at
  ON conformal_predictions (tenant_id, prediction_type, predicted_at DESC);

-- -----------------------------------------------------------------------------
-- conformal_observations — one row per landed outcome (covered or not).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conformal_observations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Matches conformal_predictions.prediction_id (same tenant). Not an FK to the
  -- uuid PK because callers key off their own stable prediction id; the
  -- (tenant_id, prediction_id) pair is the logical join.
  prediction_id      text        NOT NULL,
  prediction_type    text        NOT NULL,
  -- The realised outcome value (domain-neutral double). NULL when the only
  -- observable signal is the boolean coverage flag.
  observed_value     double precision,
  -- TRUE iff observed_value fell inside [predicted_lower, predicted_upper] at
  -- emit time. This is the single bit the ACI update consumes.
  covered            boolean     NOT NULL,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  observed_at        timestamptz NOT NULL DEFAULT now(),
  created_by         text
);

DO $$
BEGIN
  -- One observation per (tenant, prediction_id): an outcome lands once.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_observations_tenant_prediction_uq'
  ) THEN
    ALTER TABLE conformal_observations
      ADD CONSTRAINT conformal_observations_tenant_prediction_uq
      UNIQUE (tenant_id, prediction_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conformal_observations_tenant_type_at
  ON conformal_observations (tenant_id, prediction_type, observed_at DESC);

-- -----------------------------------------------------------------------------
-- conformal_calibration_state — one row per (tenant, prediction_type).
-- Persists the ACI state: current alpha + the rolling coverage window, plus the
-- immutable config (target coverage / learning rate / window size) so a reload
-- reconstructs the exact same state machine.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conformal_calibration_state (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prediction_type    text        NOT NULL,
  target_coverage    double precision NOT NULL DEFAULT 0.9,
  -- Current calibrated alpha — the value fed back into the confidence path.
  alpha              double precision NOT NULL DEFAULT 0.1,
  learning_rate      double precision NOT NULL DEFAULT 0.05,
  window_size        integer     NOT NULL DEFAULT 200,
  -- The rolling window of recent CoverageObservation values
  -- ([{predictedCovered, observedAtIso}, ...]) so updateConformal resumes
  -- exactly where it left off. Bounded by window_size at write time.
  recent             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Running counts for cheap diagnostics without scanning observations.
  observations_count bigint      NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_state_alpha_chk'
  ) THEN
    ALTER TABLE conformal_calibration_state
      ADD CONSTRAINT conformal_state_alpha_chk
      CHECK (alpha BETWEEN 0 AND 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_state_target_chk'
  ) THEN
    ALTER TABLE conformal_calibration_state
      ADD CONSTRAINT conformal_state_target_chk
      CHECK (target_coverage BETWEEN 0 AND 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_state_window_chk'
  ) THEN
    ALTER TABLE conformal_calibration_state
      ADD CONSTRAINT conformal_state_window_chk
      CHECK (window_size > 0);
  END IF;

  -- Exactly one ACI state per (tenant, prediction_type) — upserted last-write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conformal_state_tenant_type_uq'
  ) THEN
    ALTER TABLE conformal_calibration_state
      ADD CONSTRAINT conformal_state_tenant_type_uq
      UNIQUE (tenant_id, prediction_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conformal_state_tenant_type
  ON conformal_calibration_state (tenant_id, prediction_type);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (FORCE on all three tables).
-- -----------------------------------------------------------------------------

ALTER TABLE conformal_predictions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conformal_predictions       FORCE  ROW LEVEL SECURITY;
ALTER TABLE conformal_observations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conformal_observations      FORCE  ROW LEVEL SECURITY;
ALTER TABLE conformal_calibration_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE conformal_calibration_state FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'conformal_predictions'
       AND policyname = 'conformal_predictions_tenant_isolation'
  ) THEN
    CREATE POLICY conformal_predictions_tenant_isolation
      ON conformal_predictions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'conformal_observations'
       AND policyname = 'conformal_observations_tenant_isolation'
  ) THEN
    CREATE POLICY conformal_observations_tenant_isolation
      ON conformal_observations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'conformal_calibration_state'
       AND policyname = 'conformal_calibration_state_tenant_isolation'
  ) THEN
    CREATE POLICY conformal_calibration_state_tenant_isolation
      ON conformal_calibration_state
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.conformal_predictions FROM anon;';
    EXECUTE 'REVOKE ALL ON public.conformal_observations FROM anon;';
    EXECUTE 'REVOKE ALL ON public.conformal_calibration_state FROM anon;';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN (dev/staging only — also lives at down/0299_down_conformal_calibration.sql)
-- Dropping these tables loses every persisted prediction, observation, and the
-- learned ACI state (alpha resets to the cold-start default). A production
-- rollback must export them first if the calibration history is retained for
-- audit / model-governance.
-- -----------------------------------------------------------------------------
-- BEGIN;
--
-- DROP POLICY IF EXISTS conformal_calibration_state_tenant_isolation
--   ON conformal_calibration_state;
-- DROP POLICY IF EXISTS conformal_observations_tenant_isolation
--   ON conformal_observations;
-- DROP POLICY IF EXISTS conformal_predictions_tenant_isolation
--   ON conformal_predictions;
--
-- DROP INDEX IF EXISTS idx_conformal_state_tenant_type;
-- DROP INDEX IF EXISTS idx_conformal_observations_tenant_type_at;
-- DROP INDEX IF EXISTS idx_conformal_predictions_tenant_type_at;
--
-- DROP TABLE IF EXISTS conformal_calibration_state;
-- DROP TABLE IF EXISTS conformal_observations;
-- DROP TABLE IF EXISTS conformal_predictions;
--
-- COMMIT;
-- =============================================================================
