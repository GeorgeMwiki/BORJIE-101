-- =============================================================================
-- Migration 0286 — Mining onboarding runs (FLOW-2 — the owner onboarding
--                   wizard's server-persisted stepped state).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner-web onboarding wizard (apps/owner-web/src/app/(routes)/onboarding)
-- is a five-step flow — kyb -> licences -> sites -> drill_holes -> cockpit_seed
-- — driven by POST /api/v1/mining/onboarding/start | advance | complete
-- (apps/owner-web/src/lib/queries/onboarding.ts). Until now NO handler existed
-- for those three verbs (only /ingest + /commit), so the wizard 404'd on mount.
--
-- This table is the run's durable spine: ONE row per onboarding run, holding
-- the current step + status + an append-only `steps` jsonb of every advanced
-- step's payload (so a reload resumes exactly where the owner left off, and a
-- file-bearing step's payload is PERSISTED, not discarded). It is distinct
-- from:
--   * onboarding_signup_sessions (0188) — the PRE-tenant email/password signup
--     flow (no auth context, different lifecycle).
--   * onboarding_state (0141)           — the one-row-per-tenant Day-1 jumpstart
--     gate, not a stepped wizard.
--   * data_onboarding_sessions (0022)   — the per-file recipe-pipeline ingest
--     sessions (the /commit path this orchestrator can call UNDER THE HOOD).
--
-- HARD MONEY BOUNDARY (CLAUDE.md): no money column. Onboarding never moves
-- money; it seeds the cockpit.
--
-- Forward-only. Append-only per CLAUDE.md "Migrations are immutable".
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0159/0284):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds). NEVER the legacy app.tenant_id. Every row also
--   carries created_by_user_id so the route can defend-in-depth scope to the
--   signed-in operator (no IDOR across cockpit users).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mining_onboarding_runs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text          NOT NULL,
  created_by_user_id  text          NOT NULL,
  -- kyb | licences | sites | drill_holes | cockpit_seed | complete
  current_step        text          NOT NULL DEFAULT 'kyb',
  -- in_progress | complete | abandoned
  status              text          NOT NULL DEFAULT 'in_progress',
  -- Append-only map of step -> persisted payload (incl. uploaded file refs).
  -- The owner's reload re-reads this to resume; a file-bearing step's payload
  -- is recorded here verbatim so it is never lost.
  steps               jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Set when /complete seeds the cockpit (the brief / first-site / thread ids).
  cockpit_seed        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  started_at          timestamptz   NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT mining_onboarding_runs_step_chk CHECK (
    current_step IN ('kyb', 'licences', 'sites', 'drill_holes', 'cockpit_seed', 'complete')
  ),
  CONSTRAINT mining_onboarding_runs_status_chk CHECK (
    status IN ('in_progress', 'complete', 'abandoned')
  )
);

CREATE INDEX IF NOT EXISTS idx_mining_onboarding_runs_tenant_status
  ON mining_onboarding_runs (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mining_onboarding_runs_tenant_user
  ON mining_onboarding_runs (tenant_id, created_by_user_id, created_at DESC);

-- RLS FORCE — mirrors mig 0159 / 0284 EXACTLY (canonical app.current_tenant_id GUC).
ALTER TABLE mining_onboarding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_onboarding_runs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_onboarding_runs'
       AND policyname = 'mining_onboarding_runs_tenant_isolation'
  ) THEN
    CREATE POLICY mining_onboarding_runs_tenant_isolation
      ON mining_onboarding_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE mining_onboarding_runs IS
  'Owner onboarding-wizard run state (FLOW-2). One row per run: current_step + '
  'status + an append-only steps jsonb of each advanced step''s payload (incl. '
  'uploaded file refs) so a reload resumes where the owner left off. No money '
  'column. FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMIT;
