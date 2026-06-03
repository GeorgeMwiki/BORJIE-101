-- =============================================================================
-- Migration 0276 — Brain sleep-pass durability (LP-21a)
--
-- Replaces the in-memory `Map` that services/sleep-pass-orchestrator used to
-- keep all run state in. A crash (OOM / SIGKILL) lost every audit trail of
-- what the brain did overnight, and a stuck `running` pass could silently
-- starve later ticks. Two durable tables fix this:
--
--   brain_sleep_runs
--     One row per pass invocation. Inserted with status='running' before the
--     pass starts, updated to done | failed | timeout | skipped afterwards.
--     Carries items_processed / items_emitted / duration_ms / notes_text /
--     error_text. The runSleepTick loop also uses the freshest started_at to
--     honour each pass's min-interval (so two overlapping cron triggers don't
--     double-fire) and reaps stale 'running' rows (presumed crash).
--
--   brain_sleep_emissions
--     What each pass "dreamed about" — one row per emission, FK → run_id with
--     ON DELETE CASCADE. emission_kind is the kebab-case kind (lesson, nudge,
--     counterfactual, …); emission_jsonb is the verbatim payload. The admin
--     browse route surfaces these as "what the brain dreamed about last night".
--
-- ── SECURITY MODEL ────────────────────────────────────────────────────────────
-- These are SYSTEM tables for the cross-tenant brain heartbeat. The sleep tick
-- runs as a platform job under the service-role connection; there is NO
-- app.current_tenant_id GUC bound. tenant_id is therefore NULLABLE (a pass may
-- be tenant-scoped or platform-wide) and is NOT the isolation mechanism.
--
-- We still ENABLE + FORCE ROW LEVEL SECURITY on both tables and add a
-- permissive service-managed policy (USING true WITH CHECK true) so they comply
-- with the CLAUDE.md "RLS is FORCE-enabled on every tenant-scoped table" hard
-- rule (mirrors migration 0188 / Supabase's service-managed auth.* tables).
-- Isolation comes from table-level grants: REVOKE ALL from anon + authenticated
-- so a USING(true) policy can never serve brain-internal rows over the public
-- PostgREST API. Only the gateway's privileged connection (and BYPASSRLS
-- service_role) touch these rows. anon/authenticated guards make the migration
-- safe on a vanilla PG / empty CI database.
--
-- IDEMPOTENT (IF NOT EXISTS + DO blocks). FORWARD-ONLY. Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- ─── Table 1: brain_sleep_runs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_sleep_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable kebab-case pass id (e.g. 'dead-letter-replay', 'audit-chain-verify').
  pass_id          text        NOT NULL,
  -- NULL for platform-wide passes; set when a pass is scoped to one tenant.
  tenant_id        text,
  status           text        NOT NULL DEFAULT 'running',
  items_processed  integer     NOT NULL DEFAULT 0,
  items_emitted    integer     NOT NULL DEFAULT 0,
  duration_ms      integer     NOT NULL DEFAULT 0,
  notes_text       text,
  error_text       text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CONSTRAINT brain_sleep_runs_status_chk
    CHECK (status IN ('running', 'done', 'failed', 'timeout', 'skipped'))
);

-- Hot path: "freshest run for this pass" (min-interval skip + stuck-row reap).
CREATE INDEX IF NOT EXISTS idx_brain_sleep_runs_pass_started
  ON brain_sleep_runs (pass_id, started_at DESC);

-- Partial index over in-flight rows — the single-flight / rescue lookup.
CREATE INDEX IF NOT EXISTS idx_brain_sleep_runs_running
  ON brain_sleep_runs (pass_id, started_at DESC)
  WHERE status = 'running';

ALTER TABLE brain_sleep_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_sleep_runs FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'brain_sleep_runs'
       AND policyname = 'brain_sleep_runs_service_managed'
  ) THEN
    -- Service-managed: the gateway's service-role connection owns these rows.
    -- No per-tenant GUC filter — see SECURITY MODEL above.
    CREATE POLICY brain_sleep_runs_service_managed
      ON brain_sleep_runs
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ─── Table 2: brain_sleep_emissions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_sleep_emissions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid        NOT NULL REFERENCES brain_sleep_runs(id) ON DELETE CASCADE,
  emission_kind  text        NOT NULL,
  emission_jsonb jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Browse path: all emissions for a run, newest first.
CREATE INDEX IF NOT EXISTS idx_brain_sleep_emissions_run
  ON brain_sleep_emissions (run_id, created_at DESC);

ALTER TABLE brain_sleep_emissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_sleep_emissions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'brain_sleep_emissions'
       AND policyname = 'brain_sleep_emissions_service_managed'
  ) THEN
    CREATE POLICY brain_sleep_emissions_service_managed
      ON brain_sleep_emissions
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ─── Lock down: SERVICE-MANAGED ONLY (never exposed via the PostgREST API).
-- The RLS policies above are permissive (USING true) because there is no
-- tenant GUC to gate on, so isolation MUST come from table-level grants: revoke
-- all access from the PostgREST roles (anon, authenticated). Only the gateway's
-- privileged DB connection (and BYPASSRLS service_role) may touch these rows.
-- Guarded by role existence so the migration also applies on a vanilla PG.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON brain_sleep_runs      FROM anon;
    REVOKE ALL ON brain_sleep_emissions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON brain_sleep_runs      FROM authenticated;
    REVOKE ALL ON brain_sleep_emissions FROM authenticated;
  END IF;
END $$;

COMMIT;
