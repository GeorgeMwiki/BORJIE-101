-- =============================================================================
-- Migration 0040 — Strategic Direction Layer (Wave M10–M12)
--
-- Spec: Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md §15 (Wave M10–M12
-- Addendum).
--
-- Adds the durable substrate for the strategic-direction loop:
--   1. north_star_objectives   — durable goal records (OKR-shaped) with
--                                proposed/active/met/missed/retired
--                                state machine. T2 events flow through
--                                @borjie/mutation-authority.
--   2. objective_progress      — append-only observation log per
--                                objective. Velocity + drift signal are
--                                computed off the latest rows.
--   3. pivot_proposals         — LLM-drafted retarget / reframe /
--                                retire-and-replace recommendations when
--                                drift goes off_track for ≥7 days.
--   4. federation_consents     — per-tenant opt-in gate for
--                                cross-tenant cognitive-memory federation.
--                                Default deny, scoped, expiring,
--                                revocable (prospective).
--   5. epsilon_budgets         — per-tenant per-period Rényi-DP budget
--                                cap. Monthly periods.
--   6. epsilon_ledger          — append-only audit log of every
--                                ε-charge against a budget. Idempotent
--                                via (op_kind, op_id).
--
-- All six tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from
-- migration 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. north_star_objectives — the durable goal record
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS north_star_objectives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  -- 'tenant_root' or an org_unit_id (Wave 18Y org-scope).
  scope_id        text NOT NULL,
  title           text NOT NULL,
  description     text NOT NULL,
  metric_name     text NOT NULL,
  target_value    numeric NOT NULL,
  target_at       timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'proposed',
  owner_user_id   uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  prev_hash       text,
  CONSTRAINT nso_status_known CHECK (
    status IN ('proposed','active','met','missed','retired')
  ),
  CONSTRAINT nso_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT nso_metric_length CHECK (char_length(metric_name) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_nso_tenant_status
  ON north_star_objectives (tenant_id, status, target_at);
CREATE INDEX IF NOT EXISTS idx_nso_tenant_scope
  ON north_star_objectives (tenant_id, scope_id, status);
CREATE INDEX IF NOT EXISTS idx_nso_owner
  ON north_star_objectives (tenant_id, owner_user_id, status);

ALTER TABLE north_star_objectives ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'north_star_objectives'
       AND policyname = 'nso_tenant_isolation'
  ) THEN
    CREATE POLICY nso_tenant_isolation ON north_star_objectives
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. objective_progress — append-only observation log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS objective_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    uuid NOT NULL REFERENCES north_star_objectives(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  observed_value  numeric NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_hash      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_objective_recorded
  ON objective_progress (objective_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_tenant_recorded
  ON objective_progress (tenant_id, recorded_at DESC);

ALTER TABLE objective_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'objective_progress'
       AND policyname = 'op_tenant_isolation'
  ) THEN
    CREATE POLICY op_tenant_isolation ON objective_progress
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. pivot_proposals — LLM-drafted retarget / reframe / retire suggestions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pivot_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    uuid NOT NULL REFERENCES north_star_objectives(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  rationale       text NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'open',
  decided_by      uuid,
  decided_at      timestamptz,
  audit_hash      text NOT NULL,
  CONSTRAINT pp_status_known CHECK (
    status IN ('open','accepted','rejected','expired')
  ),
  CONSTRAINT pp_decided_consistent CHECK (
    (status = 'open' AND decided_by IS NULL AND decided_at IS NULL) OR
    (status IN ('accepted','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL) OR
    (status = 'expired')
  )
);

CREATE INDEX IF NOT EXISTS idx_pp_objective_proposed
  ON pivot_proposals (objective_id, proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pp_tenant_open
  ON pivot_proposals (tenant_id, proposed_at DESC)
  WHERE status = 'open';

ALTER TABLE pivot_proposals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pivot_proposals'
       AND policyname = 'pp_tenant_isolation'
  ) THEN
    CREATE POLICY pp_tenant_isolation ON pivot_proposals
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 4. federation_consents — per-tenant opt-in gate for cognitive-memory
--    cross-tenant federation
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS federation_consents (
  tenant_id       text NOT NULL,
  scope           text NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  granted_by      uuid NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  revoked_at      timestamptz,
  revoked_by      uuid,
  audit_hash      text NOT NULL,
  CONSTRAINT fc_scope_known CHECK (
    scope IN ('patterns','rules','terminology','failures','all')
  ),
  CONSTRAINT fc_status_known CHECK (
    status IN ('active','revoked','expired')
  ),
  CONSTRAINT fc_expiry_after_grant CHECK (expires_at > granted_at),
  CONSTRAINT fc_revoke_consistent CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL) OR
    (status = 'expired' AND revoked_by IS NULL)
  ),
  PRIMARY KEY (tenant_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_fc_tenant_status
  ON federation_consents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fc_expiry
  ON federation_consents (expires_at)
  WHERE status = 'active';

ALTER TABLE federation_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'federation_consents'
       AND policyname = 'fc_tenant_isolation'
  ) THEN
    CREATE POLICY fc_tenant_isolation ON federation_consents
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 5. epsilon_budgets — per-tenant per-period DP budget cap
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS epsilon_budgets (
  tenant_id       text NOT NULL,
  -- monthly period anchored to first-of-month (YYYY-MM-01).
  period_start    date NOT NULL,
  total_epsilon   numeric NOT NULL,
  spent_epsilon   numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  CONSTRAINT eb_total_positive CHECK (total_epsilon > 0),
  CONSTRAINT eb_spent_nonneg CHECK (spent_epsilon >= 0),
  CONSTRAINT eb_spent_within_total CHECK (spent_epsilon <= total_epsilon),
  PRIMARY KEY (tenant_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_eb_tenant_period
  ON epsilon_budgets (tenant_id, period_start DESC);

ALTER TABLE epsilon_budgets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'epsilon_budgets'
       AND policyname = 'eb_tenant_isolation'
  ) THEN
    CREATE POLICY eb_tenant_isolation ON epsilon_budgets
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 6. epsilon_ledger — append-only ε-charge log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS epsilon_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  period_start    date NOT NULL,
  charge_epsilon  numeric NOT NULL,
  op_kind         text NOT NULL,
  -- (tenant_id, op_kind, op_id) is the idempotency key.
  op_id           text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  CONSTRAINT el_charge_positive CHECK (charge_epsilon > 0),
  CONSTRAINT el_op_kind_length CHECK (char_length(op_kind) BETWEEN 1 AND 64),
  CONSTRAINT el_op_id_length CHECK (char_length(op_id) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_el_idempotency
  ON epsilon_ledger (tenant_id, op_kind, op_id);
CREATE INDEX IF NOT EXISTS idx_el_tenant_period
  ON epsilon_ledger (tenant_id, period_start, recorded_at DESC);

ALTER TABLE epsilon_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'epsilon_ledger'
       AND policyname = 'el_tenant_isolation'
  ) THEN
    CREATE POLICY el_tenant_isolation ON epsilon_ledger
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
