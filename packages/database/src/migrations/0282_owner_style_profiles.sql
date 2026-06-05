-- =============================================================================
-- Migration 0282 — Owner-style learned communication profile (gap-8).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Ported from the BossNyumba owner_style_profiles table, retargeted
-- real-estate → mining. Mr. Mwikila adapts HOW it speaks to each mining owner
-- — verbosity, detail, language (EN/SW), formality, posture — learned online
-- via a Bayesian feedback loop (decay 0.98 + reaction-boost). Borjie had no
-- equivalent: there was NO per-tenant communication-style profile. This
-- migration adds the single tenant-scoped table backing that profile and the
-- OwnerStyleProfileStore port (createPgOwnerStyleProfileStore) consumed by the
-- @borjie/ai-copilot orchestrator's owner-style seam.
--
-- Table:
--   * owner_style_profiles   — one row per tenant. Headline category +
--                              confidence per dimension in typed columns; the
--                              full Dirichlet posterior in profile_json.
--
-- TENANT SCOPE (CLAUDE.md hard rule):
--   tenant_id is TEXT (no uuid cast — matches the Borjie mining-domain
--   convention, see 0279). FORCE RLS on the canonical
--   current_setting('app.current_tenant_id', true) GUC (the GUC the
--   api-gateway databaseMiddleware binds). NEVER the legacy app.tenant_id.
--
-- LANGUAGE: language_preference stores a learned LEAN only. The ABSOLUTE
-- EN/SW toggle stays owned by user settings and wins at render time — this
-- profile never overrides it. Scores are dimensionless [0,1]; nothing here
-- hard-codes a jurisdiction currency.
--
-- IDEMPOTENT + FORWARD-ONLY (CLAUDE.md hard rule: migrations are immutable).
-- Every object uses IF NOT EXISTS / guarded DO-blocks so a fresh DB and a
-- re-run both converge. References ONLY already-shipped objects (no cross-
-- migration FK is added so this file never depends on a later migration).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- owner_style_profiles
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_style_profiles (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text          NOT NULL,

  verbosity           text          NOT NULL DEFAULT 'balanced',
  detail              text          NOT NULL DEFAULT 'medium',
  formality           text          NOT NULL DEFAULT 'neutral',
  posture             text          NOT NULL DEFAULT 'balanced',
  language_preference text          NOT NULL DEFAULT 'en',

  verbosity_score     numeric(5, 4) NOT NULL DEFAULT 0,
  detail_score        numeric(5, 4) NOT NULL DEFAULT 0,
  formality_score     numeric(5, 4) NOT NULL DEFAULT 0,
  posture_score       numeric(5, 4) NOT NULL DEFAULT 0,
  confidence          numeric(5, 4) NOT NULL DEFAULT 0,

  feedback_count      integer       NOT NULL DEFAULT 0,
  updated_by_signal   text,

  profile_json        jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_tenant_uq'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_tenant_uq UNIQUE (tenant_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_verbosity_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_verbosity_chk
      CHECK (verbosity IN ('terse', 'balanced', 'verbose'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_detail_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_detail_chk
      CHECK (detail IN ('low', 'medium', 'high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_formality_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_formality_chk
      CHECK (formality IN ('formal', 'neutral', 'casual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_posture_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_posture_chk
      CHECK (posture IN ('cautious', 'balanced', 'bold'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_language_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_language_chk
      CHECK (language_preference IN (
        'en', 'en_leaning_bilingual', 'sw_leaning_bilingual', 'sw'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_confidence_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_confidence_chk
      CHECK (
        confidence       >= 0 AND confidence       <= 1 AND
        verbosity_score  >= 0 AND verbosity_score  <= 1 AND
        detail_score     >= 0 AND detail_score     <= 1 AND
        formality_score  >= 0 AND formality_score  <= 1 AND
        posture_score    >= 0 AND posture_score    <= 1
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_style_profiles_feedback_count_chk'
  ) THEN
    ALTER TABLE owner_style_profiles
      ADD CONSTRAINT owner_style_profiles_feedback_count_chk
      CHECK (feedback_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS owner_style_profiles_tenant_updated
  ON owner_style_profiles (tenant_id, updated_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — tenant-scoped, FORCE-enabled, on the canonical app.current_tenant_id
-- GUC. tenant_id is TEXT so the comparison needs NO cast. The api-gateway
-- databaseMiddleware binds the GUC and refuses unauthenticated calls BEFORE
-- the policy is evaluated.
-- -----------------------------------------------------------------------------

ALTER TABLE owner_style_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_style_profiles FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_style_profiles'
       AND policyname = 'owner_style_profiles_tenant_isolation'
  ) THEN
    CREATE POLICY owner_style_profiles_tenant_isolation
      ON owner_style_profiles
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- anon is a Supabase construct; guard so the migration still applies on a
-- vanilla Postgres (CI empty-PG check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.owner_style_profiles FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE owner_style_profiles IS
  'Owner-style learned communication profile (migration 0282 / gap-8; ported '
  'from the BN owner_style_profiles table, retargeted real-estate -> mining). '
  'One row per tenant: HOW Mr. Mwikila should speak to the mining owner — '
  'verbosity / detail / language / formality / posture — learned online via a '
  'Bayesian feedback loop (decay 0.98 + reaction-boost). Headline category + '
  'per-dimension confidence in typed columns; the full Dirichlet posterior in '
  'profile_json. language_preference is a learned LEAN only — the absolute '
  'EN/SW toggle stays owned by user settings. Tenant-scoped FORCE RLS on the '
  'canonical app.current_tenant_id GUC.';

COMMIT;
