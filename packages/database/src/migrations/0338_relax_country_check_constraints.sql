-- =============================================================================
-- Migration 0338 — relax the hardcoded country CHECK constraints to SHAPE checks.
--
-- WHY (the last DB-layer hardcode in the generative jurisdiction flow): the
-- launch-market gate is now DATA (`enabled_countries`, migration 0337, seeded
-- TZ-only) and signup reads it at the route layer. But two legacy CHECK
-- constraints still hardcode literal country lists:
--   * 0085  tenants_country_chk         country IN ('TZ','KE','UG','NG','OTHER')
--   * 0087  buyers_country_signup_chk   country IN ('TZ','KE','UG','NG','CN','IN','AE','EU','OTHER')
-- With those in place, promoting a NEW market (e.g. 'US') via
-- `mwikila.jurisdiction.promote` would still fail at INSERT time — the DB
-- would veto a country the platform had legitimately enabled. That violates
-- "jurisdiction is never hardcoded" at the deepest layer.
--
-- THE FIX: replace the literal lists with SHAPE checks (ISO-3166-1 alpha-2/3
-- uppercase, or the legacy 'OTHER' sentinel, or NULL where it was nullable).
-- WHICH countries are allowed remains enforced — but by the application-layer
-- launch-market gate against `enabled_countries` (route-level, data-driven,
-- TZ-only today), not by frozen DDL. The shape check still blocks garbage.
--
-- SAFETY: strictly WIDENING (every previously-valid value still passes), so no
-- existing row can violate the new constraint — no backfill hazard, no table
-- rewrite (CHECK constraints validate new writes; ADD CONSTRAINT scans but all
-- rows pass by construction). Idempotent: guarded drops + duplicate-safe adds.
--
-- Companion down: down/0338_down_relax_country_check_constraints.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- tenants.country — was: IN ('TZ','KE','UG','NG','OTHER') OR NULL (0085).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'tenants_country_chk'
         AND conrelid = 'public.tenants'::regclass
    ) THEN
      ALTER TABLE tenants DROP CONSTRAINT tenants_country_chk;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'tenants_country_shape_chk'
         AND conrelid = 'public.tenants'::regclass
    ) THEN
      ALTER TABLE tenants
        ADD CONSTRAINT tenants_country_shape_chk
        CHECK (country IS NULL OR country ~ '^[A-Z]{2,3}$' OR country = 'OTHER');
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- buyers.country — was: IN ('TZ','KE','UG','NG','CN','IN','AE','EU','OTHER') (0087).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.buyers') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'buyers_country_signup_chk'
         AND conrelid = 'public.buyers'::regclass
    ) THEN
      ALTER TABLE buyers DROP CONSTRAINT buyers_country_signup_chk;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'buyers_country_shape_chk'
         AND conrelid = 'public.buyers'::regclass
    ) THEN
      ALTER TABLE buyers
        ADD CONSTRAINT buyers_country_shape_chk
        CHECK (country ~ '^[A-Z]{2,3}$' OR country = 'OTHER');
    END IF;
  END IF;
END $$;

COMMENT ON CONSTRAINT tenants_country_shape_chk ON tenants IS
  'Shape-only country check (ISO alpha-2/3 or OTHER or NULL). WHICH countries '
  'are selectable is governed by the enabled_countries launch-market registry '
  '(migration 0337, TZ-seeded) at the application layer — never frozen DDL.';

COMMIT;
