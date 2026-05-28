-- =============================================================================
-- Migration 0114 - Outcome Telemetry (Wave CLOSED-LOOP)
--
-- Companion to:
--   - services/api-gateway/src/workers/outcome-reconciliation-worker.ts
--   - services/api-gateway/src/composition/brain-tools/outcome-predictor.ts
--   - services/api-gateway/src/services/calibration-monitor/
--   - Docs/DESIGN/CLOSED_LOOP_DISCIPLINE.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Three tables back the closed-loop telemetry contract: every action
-- proposed by the brain (or taken by the owner / an agent / an external
-- system) declares a predicted outcome, is reconciled against the
-- observed outcome after N days, and feeds a learning_signal back so
-- future predictions calibrate.
--
--   1. outcome_predictions     - "WHAT I expect to change, by WHEN, with
--                                CONFIDENCE C". One row per WRITE action.
--   2. outcome_observations    - the observed reality after the horizon
--                                elapses. One row per (prediction).
--   3. outcome_reconciliations - the gap analysis joining the two, with
--                                a learning_signal jsonb that feeds back
--                                into the brain's calibration score.
--
-- Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate. RLS
-- is FORCE-enabled on all three tables per the Borjie hard rule
-- (CLAUDE.md). Every prediction and reconciliation links into the AI
-- hash-chain via `audit_hash_id` so a tamper of either table breaks
-- chain verification on the next walk.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) outcome_predictions
-- -----------------------------------------------------------------------------
-- Recorded BEFORE the WRITE action lands. `predicted_outcome` is a
-- jsonb envelope mirroring whatever shape the observation will land in
-- (e.g. {"royalty_filed":true,"value_tzs":18400000}). Confidence is in
-- [0.000, 1.000]. When confidence is 0 and predicted_outcome is
-- {"unmodeled":true}, the wrapper is honestly declaring it cannot
-- ground the forecast - the reconciler will skip these rows.

CREATE TABLE IF NOT EXISTS outcome_predictions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text        NOT NULL,
  /** Who proposed / took the action. */
  actor_kind                  text        NOT NULL,
  actor_id                    text        NOT NULL,
  /** Brain tool id (e.g. mining.licence.renew) or external action label. */
  action_kind                 text        NOT NULL,
  /** The entity the action targets (e.g. licence / royalty_filing / shipment). */
  action_target_entity_type   text        NOT NULL,
  action_target_entity_id     text        NOT NULL,
  /** Shape mirrors the eventual observation envelope. */
  predicted_outcome           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** [0.000, 1.000]. 0 means "unmodeled" - reconciler skips. */
  prediction_confidence       numeric(4,3) NOT NULL DEFAULT 0.000,
  /** Wall-clock horizon. Reconciler ticks when created_at + horizon <= now. */
  prediction_horizon_days     integer     NOT NULL DEFAULT 30,
  /** Optional monetary forecast for scalar drift scoring. */
  predicted_value_tzs         numeric(20,2),
  /** Brain's rationale (used by the reconciler's learning_signal). */
  rationale                   text        NOT NULL DEFAULT '',
  /** AI audit chain entry id (hash-chain) for tamper-evidence. */
  audit_hash_id               text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_predictions_actor_kind_chk'
  ) THEN
    ALTER TABLE outcome_predictions
      ADD CONSTRAINT outcome_predictions_actor_kind_chk
      CHECK (actor_kind IN ('brain', 'owner', 'agent', 'external'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_predictions_confidence_chk'
  ) THEN
    ALTER TABLE outcome_predictions
      ADD CONSTRAINT outcome_predictions_confidence_chk
      CHECK (prediction_confidence >= 0 AND prediction_confidence <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_predictions_horizon_chk'
  ) THEN
    ALTER TABLE outcome_predictions
      ADD CONSTRAINT outcome_predictions_horizon_chk
      CHECK (prediction_horizon_days >= 0 AND prediction_horizon_days <= 365);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS outcome_predictions_tenant_due_idx
  ON outcome_predictions (tenant_id, created_at, prediction_horizon_days);

CREATE INDEX IF NOT EXISTS outcome_predictions_actor_kind_idx
  ON outcome_predictions (tenant_id, actor_kind, action_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS outcome_predictions_entity_idx
  ON outcome_predictions (
    tenant_id,
    action_target_entity_type,
    action_target_entity_id,
    created_at DESC
  );

ALTER TABLE outcome_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_predictions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'outcome_predictions'
       AND policyname = 'outcome_predictions_tenant_isolation'
  ) THEN
    CREATE POLICY outcome_predictions_tenant_isolation
      ON outcome_predictions
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) outcome_observations
-- -----------------------------------------------------------------------------
-- One row per (prediction). gap_pct is the abs scalar drift in [0,1]
-- when a monetary forecast was made; null for state-flip predictions.
-- `calibrated = true` once the observation has fed back into the
-- per-tenant calibration score.

CREATE TABLE IF NOT EXISTS outcome_observations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text        NOT NULL,
  prediction_id          uuid        NOT NULL
    REFERENCES outcome_predictions(id) ON DELETE CASCADE,
  /** Shape mirrors `predicted_outcome` from the parent prediction. */
  observed_outcome       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  observed_value_tzs     numeric(20,2),
  observed_at            timestamptz NOT NULL DEFAULT now(),
  /** abs(% delta) when predicted_value_tzs was set; null otherwise. */
  gap_pct                numeric(6,4),
  calibrated             boolean     NOT NULL DEFAULT false,
  /** Free-text narrative the reconciler uses to summarise the gap. */
  narrative              text        NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS outcome_observations_one_per_prediction_idx
  ON outcome_observations (tenant_id, prediction_id);

CREATE INDEX IF NOT EXISTS outcome_observations_calibrated_idx
  ON outcome_observations (tenant_id, calibrated, observed_at DESC)
  WHERE calibrated = false;

ALTER TABLE outcome_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_observations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'outcome_observations'
       AND policyname = 'outcome_observations_tenant_isolation'
  ) THEN
    CREATE POLICY outcome_observations_tenant_isolation
      ON outcome_observations
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) outcome_reconciliations
-- -----------------------------------------------------------------------------
-- The gap-analysis row joining one prediction to one observation.
-- `drift_score` is cosine distance for vector outcomes OR abs(% delta)
-- for scalar; lower is better. `learning_signal` is the jsonb envelope
-- the brain uses to calibrate future predictions of the same shape.

CREATE TABLE IF NOT EXISTS outcome_reconciliations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text        NOT NULL,
  prediction_id          uuid        NOT NULL
    REFERENCES outcome_predictions(id) ON DELETE CASCADE,
  observation_id         uuid
    REFERENCES outcome_observations(id) ON DELETE SET NULL,
  status                 text        NOT NULL,
  drift_score            numeric(6,4) NOT NULL DEFAULT 0.0,
  /** Feedback envelope: which features predicted well, which poorly. */
  learning_signal        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** AI audit chain entry id (hash-chain) for tamper-evidence. */
  audit_hash_id          text,
  reconciled_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_reconciliations_status_chk'
  ) THEN
    ALTER TABLE outcome_reconciliations
      ADD CONSTRAINT outcome_reconciliations_status_chk
      CHECK (status IN ('matched', 'divergent', 'expired', 'undetermined'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_reconciliations_drift_chk'
  ) THEN
    ALTER TABLE outcome_reconciliations
      ADD CONSTRAINT outcome_reconciliations_drift_chk
      CHECK (drift_score >= 0 AND drift_score <= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS outcome_reconciliations_one_per_prediction_idx
  ON outcome_reconciliations (tenant_id, prediction_id);

CREATE INDEX IF NOT EXISTS outcome_reconciliations_status_idx
  ON outcome_reconciliations (tenant_id, status, reconciled_at DESC);

ALTER TABLE outcome_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_reconciliations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'outcome_reconciliations'
       AND policyname = 'outcome_reconciliations_tenant_isolation'
  ) THEN
    CREATE POLICY outcome_reconciliations_tenant_isolation
      ON outcome_reconciliations
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
