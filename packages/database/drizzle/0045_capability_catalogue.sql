-- =============================================================================
-- Migration 0045 — Capability Catalogue + Measurement (Wave CAPABILITY)
--
-- Spec: Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md
--
-- Four tenant-scoped tables back the @borjie/capability-catalogue runtime
-- registry and the @borjie/capability-measurement-worker. All four use the
-- canonical `current_setting('app.tenant_id', true)` GUC RLS policy from
-- migration 0003.
--
--   1. capabilities              — the registry: (id, name, version, kind,
--                                   owner, lifecycle, dependencies,
--                                   contract jsonb). UNIQUE (tenant_id,
--                                   name, version). Seed capabilities use
--                                   the sentinel tenant id '__seed__'.
--
--   2. capability_invocations    — one row per capability call. Tracks
--                                   latency, success, error_kind, cost.
--                                   Powers the competence axis.
--
--   3. capability_outcomes       — one row per resolved outcome (FK to
--                                   invocation). Tracks claimed_confidence,
--                                   observed_outcome, user_followthrough.
--                                   Powers calibration + utility axes.
--
--   4. capability_measurements   — one row per (capability, window) per
--                                   measurement tick. Stores
--                                   competence_rate, calibration_error,
--                                   utility_rate, n_observations. Read by
--                                   the lifecycle manager.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. capabilities — the registry itself
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capabilities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Seed capabilities use '__seed__'; tenant capabilities use the tenant id. */
  tenant_id           text NOT NULL,
  name                text NOT NULL,
  version             text NOT NULL,
  /** atomic | meta | tenant */
  kind                text NOT NULL,
  /** 'platform' for seeds, 'tenant:<id>' for tenant-authored, 'junior:<id>' for spawned. */
  owner               text NOT NULL,
  /** draft | shadow | live | locked | deprecated */
  lifecycle_state     text NOT NULL DEFAULT 'draft',
  /** Array of capability ids this capability depends on. Empty for atomics. */
  dependencies        text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Zod-encoded I/O contract + cost/latency budgets. */
  contract            jsonb NOT NULL,
  /** seed | spawned | tenant_authored */
  provenance_class    text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  prev_hash           text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_kind_chk'
  ) THEN
    ALTER TABLE capabilities
      ADD CONSTRAINT capabilities_kind_chk
      CHECK (kind IN ('atomic', 'meta', 'tenant'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_lifecycle_chk'
  ) THEN
    ALTER TABLE capabilities
      ADD CONSTRAINT capabilities_lifecycle_chk
      CHECK (lifecycle_state IN ('draft', 'shadow', 'live', 'locked', 'deprecated'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_provenance_chk'
  ) THEN
    ALTER TABLE capabilities
      ADD CONSTRAINT capabilities_provenance_chk
      CHECK (provenance_class IN ('seed', 'spawned', 'tenant_authored'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'capabilities_tenant_name_version_uniq'
  ) THEN
    ALTER TABLE capabilities
      ADD CONSTRAINT capabilities_tenant_name_version_uniq
      UNIQUE (tenant_id, name, version);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_capabilities_tenant_lifecycle
  ON capabilities (tenant_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_capabilities_tenant_kind
  ON capabilities (tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_capabilities_name
  ON capabilities (name, version);
CREATE INDEX IF NOT EXISTS idx_capabilities_audit_hash
  ON capabilities (audit_hash);

-- -----------------------------------------------------------------------------
-- 2. capability_invocations — one row per call (powers competence)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capability_invocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  capability_id       uuid NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  invoked_at          timestamptz NOT NULL DEFAULT now(),
  latency_ms          integer NOT NULL DEFAULT 0,
  success             boolean NOT NULL,
  /** Free-form error class (e.g. 'timeout', 'contract_violation', 'downstream_500'). */
  error_kind          text,
  cost_usd_cents      integer NOT NULL DEFAULT 0,
  audit_hash          text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_invocations_latency_chk'
  ) THEN
    ALTER TABLE capability_invocations
      ADD CONSTRAINT capability_invocations_latency_chk
      CHECK (latency_ms >= 0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_invocations_cost_chk'
  ) THEN
    ALTER TABLE capability_invocations
      ADD CONSTRAINT capability_invocations_cost_chk
      CHECK (cost_usd_cents >= 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cap_invocations_tenant_capability_time
  ON capability_invocations (tenant_id, capability_id, invoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_cap_invocations_capability_time
  ON capability_invocations (capability_id, invoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_cap_invocations_audit_hash
  ON capability_invocations (audit_hash);

-- -----------------------------------------------------------------------------
-- 3. capability_outcomes — one row per resolved outcome (calibration + utility)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capability_outcomes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invocation_id         uuid NOT NULL REFERENCES capability_invocations(id) ON DELETE CASCADE,
  claimed_confidence    real NOT NULL,
  /** confirmed | disconfirmed | partial | unknown */
  observed_outcome      text NOT NULL,
  /** accepted | modified | rejected | ignored */
  user_followthrough    text NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  audit_hash            text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_outcomes_confidence_chk'
  ) THEN
    ALTER TABLE capability_outcomes
      ADD CONSTRAINT capability_outcomes_confidence_chk
      CHECK (claimed_confidence >= 0 AND claimed_confidence <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_outcomes_observed_chk'
  ) THEN
    ALTER TABLE capability_outcomes
      ADD CONSTRAINT capability_outcomes_observed_chk
      CHECK (observed_outcome IN ('confirmed', 'disconfirmed', 'partial', 'unknown'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_outcomes_followthrough_chk'
  ) THEN
    ALTER TABLE capability_outcomes
      ADD CONSTRAINT capability_outcomes_followthrough_chk
      CHECK (user_followthrough IN ('accepted', 'modified', 'rejected', 'ignored'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cap_outcomes_invocation
  ON capability_outcomes (invocation_id);
CREATE INDEX IF NOT EXISTS idx_cap_outcomes_recorded
  ON capability_outcomes (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_cap_outcomes_audit_hash
  ON capability_outcomes (audit_hash);

-- -----------------------------------------------------------------------------
-- 4. capability_measurements — one row per (capability, window) per tick
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capability_measurements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  capability_id       uuid NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  /** 7 | 28 | 91 */
  window_days         integer NOT NULL,
  measured_at         timestamptz NOT NULL DEFAULT now(),
  /** [0, 1]. successes / invocations over the window. */
  competence_rate     real NOT NULL,
  /** [0, 1]. 0 = perfect calibration; 1 = worst. */
  calibration_error   real NOT NULL,
  /** [0, 1]. accepted+0.5*modified / total resolved. */
  utility_rate        real NOT NULL,
  n_observations      integer NOT NULL,
  audit_hash          text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_measurements_window_chk'
  ) THEN
    ALTER TABLE capability_measurements
      ADD CONSTRAINT capability_measurements_window_chk
      CHECK (window_days IN (7, 28, 91));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_measurements_competence_chk'
  ) THEN
    ALTER TABLE capability_measurements
      ADD CONSTRAINT capability_measurements_competence_chk
      CHECK (competence_rate >= 0 AND competence_rate <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_measurements_calibration_chk'
  ) THEN
    ALTER TABLE capability_measurements
      ADD CONSTRAINT capability_measurements_calibration_chk
      CHECK (calibration_error >= 0 AND calibration_error <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_measurements_utility_chk'
  ) THEN
    ALTER TABLE capability_measurements
      ADD CONSTRAINT capability_measurements_utility_chk
      CHECK (utility_rate >= 0 AND utility_rate <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_measurements_observations_chk'
  ) THEN
    ALTER TABLE capability_measurements
      ADD CONSTRAINT capability_measurements_observations_chk
      CHECK (n_observations >= 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cap_measurements_tenant_capability_window
  ON capability_measurements (tenant_id, capability_id, window_days, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cap_measurements_capability_window
  ON capability_measurements (capability_id, window_days, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cap_measurements_audit_hash
  ON capability_measurements (audit_hash);

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — all four tables tenant-scoped via app.tenant_id GUC.
--    Seed-tenant rows (`__seed__`) are also visible cross-tenant on SELECT.
-- -----------------------------------------------------------------------------

ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_measurements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'capabilities'
       AND policyname = 'capabilities_tenant_isolation'
  ) THEN
    CREATE POLICY capabilities_tenant_isolation ON capabilities
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        OR tenant_id = '__seed__'
      )
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'capability_invocations'
       AND policyname = 'capability_invocations_tenant_isolation'
  ) THEN
    CREATE POLICY capability_invocations_tenant_isolation ON capability_invocations
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- capability_outcomes inherits tenant scoping through invocation_id FK;
-- the canonical app.tenant_id GUC is not on this row directly. A subquery
-- policy is used to enforce isolation through the parent invocation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'capability_outcomes'
       AND policyname = 'capability_outcomes_tenant_isolation'
  ) THEN
    CREATE POLICY capability_outcomes_tenant_isolation ON capability_outcomes
      USING (
        EXISTS (
          SELECT 1
            FROM capability_invocations ci
           WHERE ci.id = capability_outcomes.invocation_id
             AND ci.tenant_id = current_setting('app.tenant_id', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
            FROM capability_invocations ci
           WHERE ci.id = capability_outcomes.invocation_id
             AND ci.tenant_id = current_setting('app.tenant_id', true)
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'capability_measurements'
       AND policyname = 'capability_measurements_tenant_isolation'
  ) THEN
    CREATE POLICY capability_measurements_tenant_isolation ON capability_measurements
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0045_capability_catalogue.sql
-- =============================================================================
