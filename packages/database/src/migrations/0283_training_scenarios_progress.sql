-- =============================================================================
-- Migration 0283 — Training scenarios + learning progress (rehearsal surface).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Borjie's mining operators learn the job by REHEARSING it: a licence-renewal
-- negotiation, a royalty dispute, a safety-incident triage, an offtake
-- negotiation, a contractor-damage claim. This migration adds the three tables
-- backing the scenario-simulation surface (owner-web /training/scenarios) and
-- the mastery-checkpoint surface (owner-web /training/checkpoint), reached via
-- /api/v1/scenarios/*.
--
-- Ported from the BossNyumba training-scenarios stack (itself a LitFin
-- officer-portal training workspace + learning-portal mastery checkpoint port)
-- and retargeted real-estate → mining:
--   * RE scenario (arrears_negotiation / lease_compliance_interview / …) →
--     mining scenario (licence_renewal_negotiation / royalty_dispute /
--     safety_incident_triage / offtake_negotiation / contractor_damage_claim)
--   * per-concept coverage stays per-concept (the concept catalog is the
--     single source of truth — scenario CONTENT is never fabricated)
--   * borrower-learn checkpoint → learning_progress (BKT p_know; 0.7 pass gate)
--
-- Tables:
--   * scenarios          — one row per generated scenario template (built
--                          deterministically from the concept catalog — NEVER
--                          fabricated; the row records WHICH concepts + which
--                          kind produced it).
--   * scenario_sessions  — one row per learner run (append-only transcript +
--                          per-concept coverage).
--   * learning_progress  — per (tenant, user, concept) mastery snapshot fed by
--                          checkpoint results; a 0.7 pass gates the next phase.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0280/0281/0282):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds; migration 0172 unified the helper on this name).
--   The compare is bare (no cast) because tenant_id is already TEXT. NEVER the
--   legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): NOTHING here hard-codes a
-- jurisdiction currency. Scenario money figures live inside the jsonb
-- `briefing` payload as plain numbers; the surface formats with formatCurrency
-- at render time. NEVER hard-code TZS/KES/UGX/NGN.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_constraint / pg_policies checks) / CREATE (UNIQUE) INDEX IF NOT
-- EXISTS, and a pg_roles guard around the anon REVOKE. On a fully-migrated DB
-- this is a pure no-op; on a fresh / partially-applied DB it stands the tables
-- up correctly secured. scenario_sessions FK to scenarios with ON DELETE
-- CASCADE (a deleted template removes its runs); learning_progress is
-- independent of scenarios so checkpoint history survives template churn.
-- References only pre-existing infra (pgcrypto for gen_random_uuid).
--
-- Companion files:
--   * packages/database/src/schemas/training-scenarios.schema.ts
--   * packages/ai-copilot/src/training/scenario-generator.ts
--   * packages/ai-copilot/src/training/checkpoint-questions.ts
--   * services/api-gateway/src/composition/scenario-repository.ts
--   * services/api-gateway/src/routes/scenarios.hono.ts
--   * packages/api-client/src/services/training-scenarios.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- scenarios
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scenarios (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  kind              text        NOT NULL,
  title             text        NOT NULL,
  title_sw          text,
  summary           text        NOT NULL,
  summary_sw        text,
  difficulty        text        NOT NULL DEFAULT 'beginner',
  language          text        NOT NULL DEFAULT 'en',
  concept_ids       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  briefing          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estimated_minutes integer     NOT NULL DEFAULT 10,
  status            text        NOT NULL DEFAULT 'active',
  generated_by      text        NOT NULL DEFAULT 'concept_catalog',
  provenance        jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_kind_chk'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_kind_chk
      CHECK (kind IN (
        'licence_renewal_negotiation', 'royalty_dispute',
        'safety_incident_triage', 'offtake_negotiation',
        'contractor_damage_claim'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_difficulty_chk'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_difficulty_chk
      CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_status_chk'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_status_chk
      CHECK (status IN ('active', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_title_chk'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_title_chk
      CHECK (char_length(title) BETWEEN 1 AND 200);
  END IF;
END $$;

-- One canonical template per (tenant, kind, difficulty, language) so the
-- generator's upsert is idempotent and the browser never shows duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS scenarios_tenant_kind_difficulty_uq
  ON scenarios (tenant_id, kind, difficulty, language);

CREATE INDEX IF NOT EXISTS scenarios_tenant_kind
  ON scenarios (tenant_id, kind, status);

CREATE INDEX IF NOT EXISTS scenarios_tenant_status
  ON scenarios (tenant_id, status, created_at DESC);

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'scenarios'
       AND policyname = 'scenarios_tenant_isolation'
  ) THEN
    CREATE POLICY scenarios_tenant_isolation
      ON scenarios
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- scenario_sessions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scenario_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  scenario_id  uuid        NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  user_id      text        NOT NULL,
  role_mode    text        NOT NULL,
  status       text        NOT NULL DEFAULT 'in_progress',
  turns        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  coverage     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  score        double precision,
  feedback     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenario_sessions_status_chk'
  ) THEN
    ALTER TABLE scenario_sessions
      ADD CONSTRAINT scenario_sessions_status_chk
      CHECK (status IN ('in_progress', 'completed', 'abandoned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS scenario_sessions_tenant_user
  ON scenario_sessions (tenant_id, user_id, status);

CREATE INDEX IF NOT EXISTS scenario_sessions_scenario
  ON scenario_sessions (tenant_id, scenario_id, started_at DESC);

ALTER TABLE scenario_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_sessions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'scenario_sessions'
       AND policyname = 'scenario_sessions_tenant_isolation'
  ) THEN
    CREATE POLICY scenario_sessions_tenant_isolation
      ON scenario_sessions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- learning_progress  (per concept mastery; 0.7 pass gates next phase)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_progress (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  user_id      text        NOT NULL,
  concept_id   text        NOT NULL,
  p_know       double precision NOT NULL DEFAULT 0,
  attempts     integer     NOT NULL DEFAULT 0,
  correct      integer     NOT NULL DEFAULT 0,
  mastered     text        NOT NULL DEFAULT 'no',
  source       text        NOT NULL DEFAULT 'checkpoint',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learning_progress_pknow_chk'
  ) THEN
    ALTER TABLE learning_progress
      ADD CONSTRAINT learning_progress_pknow_chk
      CHECK (p_know >= 0 AND p_know <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learning_progress_mastered_chk'
  ) THEN
    ALTER TABLE learning_progress
      ADD CONSTRAINT learning_progress_mastered_chk
      CHECK (mastered IN ('yes', 'no'));
  END IF;
END $$;

-- One row per (tenant, user, concept) so checkpoint upserts converge.
CREATE UNIQUE INDEX IF NOT EXISTS learning_progress_tenant_user_concept_uq
  ON learning_progress (tenant_id, user_id, concept_id);

CREATE INDEX IF NOT EXISTS learning_progress_tenant_user
  ON learning_progress (tenant_id, user_id, last_seen_at DESC);

ALTER TABLE learning_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_progress FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'learning_progress'
       AND policyname = 'learning_progress_tenant_isolation'
  ) THEN
    CREATE POLICY learning_progress_tenant_isolation
      ON learning_progress
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
    EXECUTE 'REVOKE ALL ON public.scenarios FROM anon;';
    EXECUTE 'REVOKE ALL ON public.scenario_sessions FROM anon;';
    EXECUTE 'REVOKE ALL ON public.learning_progress FROM anon;';
  END IF;
END $$;

COMMIT;
