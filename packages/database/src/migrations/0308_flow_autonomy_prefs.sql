-- =============================================================================
-- Migration 0308 — flow-keyed autonomy preferences
--                  (flow_autonomy_prefs).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Today autonomy gating is keyed on (tenant_id) only — `tenant_autonomy_caps`
-- (migration earlier in the chain) carries ONE global envelope and there is NO
-- per-FLOW autonomy row and NO creation-time auto-vs-gated confirmation
-- (see Docs/research/ORCHESTRATION_SPEC.md §Autonomy-gating model onFlowCreation,
-- and ORCHESTRATION_FRONTIER_ADDENDUM.md §earned/graduated trust). The
-- structural gap: a created flow / workflow cannot carry its own `auto | gated`
-- posture, so the workflow-engine's human-approval step can only be governed by
-- the single global switch.
--
-- This migration adds `flow_autonomy_prefs`, keyed on (tenant_id, flow_id), so
-- each created flow records its sticky autonomy posture. Default = GATED (the
-- USER-GATED-until-explicitly-AUTO invariant). On flow CREATION the row is
-- inserted with `confirmation_state = 'pending'` so the creation-time
-- "auto-vs-gated?" confirmation surfaces (trust-calibration: the flow
-- track-record is shown at the moment of asking). Once a flow is set AUTO, the
-- workflow-engine reads this row and skips the per-run human-approval step — but
-- the autonomy-controller + the inviolable rails (policy-gate / four-eye /
-- sovereign / kill_switch / money-path) STILL apply per action; rail-gate ALWAYS
-- wins. This is an ADDITIVE gate: it can only ADD gating, never remove a rail.
--
-- SHAPE
-- -----
-- flow_autonomy_prefs
--   tenant_id           text  FK→tenants  (RLS key, canonical GUC).
--   flow_id             text  the workflow / flow identifier (e.g. a
--                             workflow definitionId or a runtime flow id). One
--                             posture row per (tenant_id, flow_id).
--   posture             text  'gated' | 'auto'. CHECK-constrained. Default
--                             'gated' — the fail-safe USER-GATED default.
--   confirmation_state  text  'pending' | 'confirmed'. CHECK-constrained.
--                             A freshly-created flow is 'pending' until the MD
--                             answers the one-time auto-vs-gated confirmation.
--   risk_ceiling        text  the highest risk tier this flow may run AUTO at
--                             (advisory ceiling; rails still gate HIGH-risk
--                             prefixes regardless). nullable.
--   amount_threshold    bigint  optional minor-unit money ceiling above which
--                             AUTO is suppressed for this flow. nullable.
--   created_by          text  user id that created the flow / posture row.
--   promoted_at         timestamptz  set when the flow is flipped to AUTO
--                             (earned-promotion timestamp). nullable.
--   created_at / updated_at  timestamptz, default now().
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors migration 0307):
--   tenant_id is TEXT and FK→tenants; the table FORCE-enables row-level
--   security with a tenant-isolation policy on the canonical
--   `app.current_tenant_id` GUC (bare compare, no cast; NEVER the legacy
--   `app.tenant_id`). A service-role bypass policy mirrors the 0307 shape so
--   the engine's globally-unique reads run under withServiceRoleContext.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
--   CREATE TABLE / INDEX IF NOT EXISTS + guarded DO-blocks, plus a pg_roles
--   guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
--   References only pre-existing infra (`tenants`). No NOT NULL is added to an
--   existing-data table (all NOT NULLs are on freshly-created columns), so the
--   NOT-NULL-backfill validator is satisfied.
--
-- Companion files:
--   * packages/database/src/schemas/flow-autonomy-prefs.schema.ts
--   * packages/workflow-engine/src/autonomy/flow-autonomy-port.ts
--   * packages/workflow-engine/src/repositories/drizzle-flow-autonomy-repository.ts
--   * services/api-gateway/src/routes/workflow/flow-autonomy.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- flow_autonomy_prefs — one sticky posture row per (tenant_id, flow_id).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS flow_autonomy_prefs (
  tenant_id          text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id            text        NOT NULL,
  -- 'gated' (USER-GATED default) | 'auto' (engine skips per-run approval;
  -- rails + controller still apply per action).
  posture            text        NOT NULL DEFAULT 'gated',
  -- 'pending' (creation-time confirmation not yet answered) | 'confirmed'.
  confirmation_state text        NOT NULL DEFAULT 'pending',
  -- Advisory risk ceiling for AUTO; rails still gate HIGH-risk regardless.
  risk_ceiling       text,
  -- Optional minor-unit money ceiling above which AUTO is suppressed.
  amount_threshold   bigint,
  created_by         text        NOT NULL,
  promoted_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flow_id),
  CONSTRAINT flow_autonomy_prefs_posture_chk
    CHECK (posture IN ('gated', 'auto')),
  CONSTRAINT flow_autonomy_prefs_confirmation_chk
    CHECK (confirmation_state IN ('pending', 'confirmed')),
  CONSTRAINT flow_autonomy_prefs_amount_chk
    CHECK (amount_threshold IS NULL OR amount_threshold >= 0)
);

-- Lookup by tenant (list the tenant's flow postures) and pending-confirmation
-- queue (creation-time confirmations awaiting an answer).
CREATE INDEX IF NOT EXISTS idx_flow_autonomy_prefs_tenant
  ON flow_autonomy_prefs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_flow_autonomy_prefs_tenant_confirmation
  ON flow_autonomy_prefs (tenant_id, confirmation_state);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE flow_autonomy_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_autonomy_prefs FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'flow_autonomy_prefs'
       AND policyname = 'flow_autonomy_prefs_tenant_isolation'
  ) THEN
    CREATE POLICY flow_autonomy_prefs_tenant_isolation
      ON flow_autonomy_prefs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Service-role bypass — mirror the 0307 shape so the workflow-engine's
-- system reads (run under withServiceRoleContext, which sets
-- app.is_service_role='true') are permitted without a tenant GUC hint. The
-- per-write + per-tenant reads still bind the concrete tenant GUC.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'flow_autonomy_prefs'
       AND policyname = 'flow_autonomy_prefs_service_role_bypass'
  ) THEN
    CREATE POLICY flow_autonomy_prefs_service_role_bypass
      ON flow_autonomy_prefs
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.flow_autonomy_prefs FROM anon;';
  END IF;
END $$;

COMMIT;
