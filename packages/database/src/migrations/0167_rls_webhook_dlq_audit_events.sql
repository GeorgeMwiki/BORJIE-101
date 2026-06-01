-- =============================================================================
-- Migration 0167 — FORCE RLS on webhook_dead_letters + audit_events
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The payment-inspector (services/api-gateway/src/services/support-diagnosis/
-- payment-inspector.ts) root-causes a user's payment issue by SELECTing the
-- diagnosis signals. Two of those signal tables — `webhook_dead_letters` (a
-- confirmation that ran out of retries) and `audit_events` (category=PAYMENT
-- failures) — carry tenant data but have NO live FORCE-RLS policy:
--   * `webhook_dead_letters` was CREATEd only in the ARCHIVED 0031 (pruned out
--     of the live set). The live 0163 creates a DIFFERENT table, `webhook_events`
--     (the dedupe claim index) — it does NOT re-materialise the DLQ.
--   * `audit_events` has a live Drizzle schema but NO live migration enables RLS
--     on it (the live append-only audit chain is `ai_audit_chain`, a different
--     table guarded by 0152).
-- So tenant isolation on these two inspector tables currently rests ONLY on the
-- inspector's app-layer `tenant_id = $1` predicate. That violates the CLAUDE.md
-- hard rule "RLS is FORCE-enabled on every tenant-scoped table". This migration
-- closes the gap by enabling + FORCING RLS and adding a tenant-isolation policy
-- on the CORRECT GUC (current_setting('app.current_tenant_id', true)) for BOTH
-- tables, so the DB enforces isolation even if an app predicate is ever dropped.
--
-- EXISTENCE-GUARDED (these tables may or may not exist in a given DB)
-- ------------------------------------------------------------------
-- Neither table is created by any LIVE numbered migration today (the DLQ lives
-- only in archived 0031; audit_events has only a Drizzle schema). Whether they
-- physically exist in a target database therefore varies by environment. Every
-- statement below is wrapped in an information_schema.tables existence check, so
-- this migration is a safe no-op where a table is absent and applies the RLS the
-- moment a table is (re-)materialised. Re-materialising the missing tables is a
-- SEPARATE task; this migration only guarantees RLS-correctness either way.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped tables -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0163/0164's
--     CORRECT GUC; never the legacy app.tenant_id). REVOKE anon (guarded for
--     vanilla PG / CI empty-PG).
--   * No money columns touched — this migration only adds RLS DDL.
--
-- IDEMPOTENT / FORWARD-ONLY / EXISTENCE-GUARDED: information_schema.tables guard
-- per table + pg_policies existence guard + pg_roles anon guard. ENABLE/FORCE are
-- no-ops when already set. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — webhook_dead_letters: FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0164 §2 EXACTLY: existence guard, ENABLE + FORCE, a pg_policies-guarded
-- tenant policy on current_setting('app.current_tenant_id', true), and the
-- pg_roles-guarded anon REVOKE. tenant_id is TEXT so the compare is bare. FOR ALL
-- covers the inspector's SELECT (and any operator replay write).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_dead_letters'
  ) THEN
    EXECUTE 'ALTER TABLE public.webhook_dead_letters ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.webhook_dead_letters FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'webhook_dead_letters'
        AND policyname = 'webhook_dead_letters_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY webhook_dead_letters_tenant_isolation ON public.webhook_dead_letters
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.webhook_dead_letters FROM anon;';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §2 — audit_events: FORCE RLS + tenant-isolation policy.
--
-- Same idiom. The inspector reads category='PAYMENT' failure rows here; tenant_id
-- is TEXT. FOR ALL covers reads (and any writer that materialises this table).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_events'
  ) THEN
    EXECUTE 'ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'audit_events'
        AND policyname = 'audit_events_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY audit_events_tenant_isolation ON public.audit_events
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.audit_events FROM anon;';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — Documentary comments (guarded: COMMENT ON a missing table would error).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_dead_letters'
  ) THEN
    EXECUTE $c$
      COMMENT ON TABLE public.webhook_dead_letters IS
        'Outbound webhook dead-letter queue. Read by the payment-inspector as a '
        'payment-diagnosis signal. RLS FORCE on app.current_tenant_id added in '
        '0167 (table itself originates from archived 0031; re-materialisation is '
        'a separate task).';
    $c$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_events'
  ) THEN
    EXECUTE $c$
      COMMENT ON TABLE public.audit_events IS
        'Structured audit-event log (category=PAYMENT failures are a payment-'
        'diagnosis signal for the inspector). RLS FORCE on app.current_tenant_id '
        'added in 0167.';
    $c$;
  END IF;
END $$;

COMMIT;
