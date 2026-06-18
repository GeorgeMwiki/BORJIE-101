-- =============================================================================
-- Migration 0366 — driver_letter_acks: re-assert RLS in the LITERAL form the
-- rls-coverage static analyzer recognises (close the false-positive gate).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Migration 0362 ALREADY enabled FORCE ROW LEVEL SECURITY on driver_letter_acks
-- plus the `driver_letter_acks_tenant_isolation` policy (canonical
-- app.current_tenant_id GUC) and the `driver_letter_acks_service_role_bypass`
-- policy. RLS is therefore correct AT RUNTIME. But 0362 wrote those statements
-- inside a SCALAR-variable dynamic block:
--
--     DO $$ DECLARE tbl text := 'driver_letter_acks';
--       BEGIN EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl); ...
--
-- The rls-coverage static analyzer (scripts/audit-rls-coverage.mjs) credits a
-- dynamic `format(... %I ...)` ENABLE/POLICY only when the SAME DO-block also
-- declares the table in a `text[]` ARRAY list (computeLoopCoverage ->
-- tableListNames). A scalar `text := '...'` block is invisible to it, so the
-- gate false-flagged driver_letter_acks as "no ENABLE ROW LEVEL SECURITY found"
-- even though enforcement is live. (Same reason migration 0365 wrote its
-- request_for_bids policies as LITERAL DROP-then-CREATE — "so the static
-- analyzer recognises them".)
--
-- This migration re-states the IDENTICAL RLS with LITERAL `ALTER TABLE
-- driver_letter_acks ...` + literal DROP-then-CREATE policies so the analyzer's
-- direct-detection path matches. RUNTIME IS UNCHANGED — every statement is
-- idempotent: ENABLE/FORCE on an already-enforced table is a no-op, and
-- DROP POLICY IF EXISTS + CREATE re-asserts each policy bit-for-bit identical to
-- 0362's. No data is touched, no lock/backfill hazard.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): to_regclass-guarded so a
-- partial/fresh DB is a clean no-op; runs AFTER 0362 in lex order so the table
-- always exists by the time this lands. Pure RLS metadata. Re-apply on a fully
-- migrated DB is a pure no-op. Immutable once shipped — never edit; append.
--
-- Companion files:
--   * packages/database/src/migrations/0362_driver_letter_acks.sql (creates table + dynamic RLS)
--   * packages/database/src/schemas/driver-letter-acks.schema.ts
--   * scripts/audit-rls-coverage.mjs (the static analyzer this satisfies)
--   * packages/database/src/migrations/down/0366_down_driver_letter_acks_rls_literal_reassert.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.driver_letter_acks') IS NULL THEN
    RAISE NOTICE 'driver_letter_acks absent — skipping RLS re-assert (fresh-DB guard)';
    RETURN;
  END IF;

  -- Literal ENABLE/FORCE (analyzer direct-path) — idempotent no-op (0362 set it).
  ALTER TABLE driver_letter_acks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE driver_letter_acks FORCE  ROW LEVEL SECURITY;

  -- Literal tenant-isolation policy (analyzer direct-path) — identical to 0362.
  DROP POLICY IF EXISTS driver_letter_acks_tenant_isolation ON driver_letter_acks;
  CREATE POLICY driver_letter_acks_tenant_isolation
    ON driver_letter_acks
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  -- Literal service-role bypass (out-of-band reconciliation/export cron) — identical to 0362.
  DROP POLICY IF EXISTS driver_letter_acks_service_role_bypass ON driver_letter_acks;
  CREATE POLICY driver_letter_acks_service_role_bypass
    ON driver_letter_acks
    FOR ALL
    USING (current_setting('app.is_service_role', true) = 'true')
    WITH CHECK (current_setting('app.is_service_role', true) = 'true');

  -- Defence-in-depth: guarded anon REVOKE (idempotent).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.driver_letter_acks FROM anon;
  END IF;
END $$;

COMMIT;
