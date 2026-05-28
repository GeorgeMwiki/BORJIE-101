-- =============================================================================
-- Migration 0090 — Scale-hardening: FORCE ROW LEVEL SECURITY sweep
--
-- Companion to:
--   - Docs/AUDIT/RLS_COVERAGE.md
--   - CLAUDE.md hard rule: "RLS is FORCE-enabled on every tenant-scoped table"
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- SCALE HARDENING wave finding:
--   Audit of every tenant-scoped table in
--   `packages/database/src/migrations/0077..0089` identified ONE
--   policy table that has `ENABLE ROW LEVEL SECURITY` but is missing
--   the constitutional `FORCE ROW LEVEL SECURITY` bit:
--
--     - pilot_feedback (0077_pilot_feedback.sql)
--
--   Without FORCE, the table-owner role (typically `postgres` or the
--   Supabase service role) bypasses every policy at the engine level. A
--   single owner-roled connection — a misconfigured migration runner, a
--   manual psql session, a worker job that forgot to drop privileges, or
--   a leaked service_role JWT — can read or mutate any tenant's rows.
--   With FORCE, every connection (owner included) is subject to the
--   tenant_isolation policy. This complements the role-level BYPASSRLS
--   guarantees the Supabase service_role connection still has
--   (intentional, for cross-tenant ops the gateway brokers).
--
-- This migration is purely additive on the FORCE bit (no schema changes,
-- no policy edits). The existing `pilot_feedback_tenant_isolation` policy
-- continues to use `current_setting('app.tenant_id', true)` — the
-- canonical GUC pattern shared with 0079..0089.
--
-- The mirror finding from the audit — `pilot_issue_links` lacking RLS
-- entirely — is INTENTIONAL by design (platform-service table, sentry
-- fingerprints are not tenant-scoped). Documented in
-- `Docs/AUDIT/RLS_COVERAGE.md`. Not modified by this migration.
--
-- Idempotent (`ALTER TABLE` is naturally idempotent for FORCE). Safe to
-- re-run. Append-only. Forward-only. Immutable per CLAUDE.md.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- pilot_feedback — close the FORCE gap from 0077.
--
-- Wrapped in an existence guard so the migration is a no-op on shards
-- where the table hasn't been provisioned yet (e.g. tenants on the
-- legacy pilot-shard that pre-dates the pilot-feedback wave).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pilot_feedback'
  ) THEN
    -- Idempotent: ALTER ... FORCE ROW LEVEL SECURITY is a no-op when
    -- already set. We deliberately do NOT touch the policy itself —
    -- 0077 installed `pilot_feedback_tenant_isolation` and that policy
    -- remains the canonical isolation predicate.
    ALTER TABLE public.pilot_feedback FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

COMMIT;
