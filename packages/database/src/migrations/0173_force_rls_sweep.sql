-- =============================================================================
-- 0173: FORCE RLS sweep — close Supabase audit F7.
--
-- Closes Supabase audit finding F7 ("RLS-enabled tables that lack FORCE ROW
-- LEVEL SECURITY"). Without FORCE, the table-owner role (typically `postgres`
-- or the Supabase service role) bypasses every policy at the engine level —
-- a single owner-roled connection (a misconfigured migration runner, a manual
-- psql session, a worker job that forgot to drop privileges, a leaked
-- service_role JWT) can read or mutate any tenant's rows. With FORCE, every
-- connection — owner included — is subject to the policy. This complements
-- the role-level BYPASSRLS guarantees the Supabase service_role connection
-- still has (intentional, for cross-tenant ops the gateway brokers).
--
-- Two waves:
--
--   1. Post-0156 drift   — tables added since migration 0157 that were
--      RLS-enabled by their own migration but never FORCE'd. The audit
--      against 0157 → 0171 found exactly ONE such table: `tool_call_denylist`
--      (created in 0157, no RLS shipped). The other post-0156 tenant-scoped
--      tables (autonomy-governance, mdr_plan_items, owner_skills, the
--      promote-out wave, accounts/ledger_entries/statements) were already
--      ENABLE + FORCE'd by their own follow-up migrations 0163 / 0166 / 0169.
--      0157's `tool_call_denylist` therefore needs BOTH ENABLE and FORCE plus
--      tenant-isolation policies installed here (no prior wrap exists).
--
--   2. Older RLS-enabled tables that PRE-DATE 0156 but were not on 0156's
--      `all_rls_tables` FORCE roster. The 0156 roster covers the canonical
--      A2b-1 RLS wave (tables 0001 + 0001c + 0002 + 0003 / 0004 / 0005 etc.
--      that 0155 promoted) and the 0156 phase-2 set, but the much earlier
--      RLS-enable statements in 0001 (organizations, users, roles, user_roles,
--      sessions, transactions), 0002 (audit_log), 0003 (notification_templates,
--      notifications), 0004 (document_access), 0005 (conversations,
--      participants, messages), 0006 (scheduled_events, availability), 0008
--      (utility_accounts, utility_readings, utility_bills), 0009 (compliance_*),
--      0011 (HR family), 0012 (brain threads family), 0013 (maintenance ops
--      satellite tables), 0014 (outbox + intelligence family), 0017
--      (inspection_extensions), 0018 (conditional_surveys / findings /
--      action_plans), 0019 (far_assignments, condition_check_events), 0032
--      (document_uploads), 0093 (webhook_dead_letters, webhook_delivery_attempts),
--      and 0111 (audit_trail_entries) — all RLS-enabled, none FORCE'd.
--
-- Strategy mirrors the proven 0156 § 2 pattern:
--   * single `DO $$ ... $$;` block walks a static table list,
--   * gates on `information_schema.tables` existence so the migration is
--     idempotent on shards where a feature-flag table is absent,
--   * uses `ALTER TABLE IF EXISTS ... FORCE ROW LEVEL SECURITY` semantics
--     by walking the list with the existence guard,
--   * does NOT touch RLS policies on tables that already have them
--     (just adds FORCE) — existing policies continue to use whichever
--     helper (current_app_tenant_id() or current_setting('app.tenant_id'))
--     the original migration installed. Z-SUPA-F2 reconciles the GUC name
--     mismatch; this migration is purely additive on the FORCE bit.
--
-- The one EXCEPTION is `tool_call_denylist`: it has zero RLS today, so this
-- migration BOTH enables RLS + installs the canonical tenant-isolation
-- policies + revokes anon + forces RLS. Pattern matches 0156 § 1.
--
-- After this migration runs `SELECT * FROM public.rls_coverage_audit;`
-- should show `rls_forced = true` for every RLS-enabled tenant-scoped
-- table on the platform.
-- =============================================================================

-- =============================================================================
-- WAVE 1 — tool_call_denylist (0157) — enable + force + policies + revoke
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_call_denylist'
  ) THEN
    -- Enable + force RLS (idempotent).
    ALTER TABLE public.tool_call_denylist ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tool_call_denylist FORCE ROW LEVEL SECURITY;

    -- Drop pre-existing policies with our canonical names (idempotent).
    DROP POLICY IF EXISTS tenant_isolation_select ON public.tool_call_denylist;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.tool_call_denylist;

    -- Tenant-scoped SELECT.
    CREATE POLICY tenant_isolation_select ON public.tool_call_denylist
      FOR SELECT
      TO authenticated
      USING (tenant_id = public.current_app_tenant_id());

    -- Tenant-scoped INSERT/UPDATE/DELETE.
    CREATE POLICY tenant_isolation_modify ON public.tool_call_denylist
      FOR ALL
      TO authenticated
      USING (tenant_id = public.current_app_tenant_id())
      WITH CHECK (tenant_id = public.current_app_tenant_id());

    -- Revoke anon access (defence-in-depth).
    REVOKE ALL ON public.tool_call_denylist FROM anon;
  END IF;
END
$$;

-- =============================================================================
-- WAVE 2 — pre-0156 RLS-enabled tables that 0156's FORCE roster missed.
--
-- Each entry is annotated with the migration that originally ENABLE'd RLS so
-- a future operator reading this file can trace the lineage.
-- =============================================================================

DO $$
DECLARE
  tbl text;
  legacy_rls_tables text[] := ARRAY[
    -- 0001 — initial schema (RLS-enabled but not in 0156's FORCE roster)
    'organizations',                  -- 0001
    'users',                          -- 0001
    'roles',                          -- 0001
    'user_roles',                     -- 0001
    'sessions',                       -- 0001
    'transactions',                   -- 0001
    -- 0002 — audit log
    'audit_log',                      -- 0002
    -- 0003 — notifications
    'notification_templates',         -- 0003
    'notifications',                  -- 0003
    -- 0004 — documents satellite (documents itself IS in 0156's roster)
    'document_access',                -- 0004
    -- 0005 — messaging
    'conversations',                  -- 0005
    'participants',                   -- 0005
    'messages',                       -- 0005
    -- 0006 — scheduling
    'scheduled_events',               -- 0006
    'availability',                   -- 0006
    -- 0008 — utilities
    'utility_accounts',               -- 0008
    'utility_readings',               -- 0008
    'utility_bills',                  -- 0008
    -- 0009 — compliance
    'compliance_items',               -- 0009
    'compliance_cases',               -- 0009
    'compliance_notices',             -- 0009
    -- 0011 — HR
    'departments',                    -- 0011
    'teams',                          -- 0011
    'employees',                      -- 0011
    'team_memberships',               -- 0011
    'assignments',                    -- 0011
    'performance_records',            -- 0011
    -- 0012 — brain threads
    'threads',                        -- 0012
    'thread_events',                  -- 0012
    'handoff_packets',                -- 0012
    -- 0013 — maintenance operations satellite tables
    --   (maintenance_requests itself IS in 0156's roster)
    'dispatch_events',                -- 0013
    'completion_proofs',              -- 0013
    'dual_signoffs',                  -- 0013
    'vendor_assignments',             -- 0013
    'assets',                         -- 0013
    'vendor_scorecards',              -- 0013
    'scheduling_events',              -- 0013
    -- 0014 — outbox + intelligence family
    'event_outbox',                   -- 0014
    'event_dead_letter',              -- 0014
    'event_subscriptions',            -- 0014
    'tenant_segments',                -- 0014
    'customer_segment_memberships',   -- 0014
    'tenant_preferences',             -- 0014
    'friction_fingerprints',          -- 0014
    'next_best_actions',              -- 0014
    'intervention_logs',              -- 0014
    'case_timelines',                 -- 0014
    'evidence_attachments',           -- 0014
    'case_resolutions',               -- 0014
    'notice_service_receipts',        -- 0014
    'ocr_extractions',                -- 0014
    'identity_profiles',              -- 0014
    'verification_badges',            -- 0014
    'escalation_chains',              -- 0014
    'inspection_items',               -- 0014
    'inspection_signatures',          -- 0014
    -- 0017 — inspection extensions
    'inspection_extensions',          -- 0017c_inspections_extensions
    -- 0018 — conditional surveys (NOTE: 0156's roster has typo "conditional_survey"
    -- singular; the real table names are plural — covered here)
    'conditional_surveys',            -- 0018
    'conditional_survey_findings',    -- 0018
    'conditional_survey_action_plans',-- 0018
    -- 0019 — FAR satellite (asset_components IS in 0156's roster)
    'far_assignments',                -- 0019
    'condition_check_events',         -- 0019
    -- 0032 — document uploads
    'document_uploads',               -- 0032
    -- 0093 — webhook RLS retrofit
    'webhook_dead_letters',           -- 0093
    'webhook_delivery_attempts',      -- 0093
    -- 0111 — audit trail v2
    'audit_trail_entries'             -- 0111
  ];
BEGIN
  FOREACH tbl IN ARRAY legacy_rls_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END
$$;

-- =============================================================================
-- WAVE 3 — operator sanity-check note
-- =============================================================================
-- After this migration runs:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM   pg_class
--   WHERE  relkind = 'r'
--     AND  relnamespace = 'public'::regnamespace
--     AND  relrowsecurity = true
--     AND  relforcerowsecurity = false;
-- ...should return ZERO rows on any tenant-scoped table. Platform-tier
-- tables that are intentionally NOT FORCE'd (e.g. `tenants` itself, which
-- is the registry the policies dereference) remain RLS-enabled but
-- unforced by design.
--
-- The companion test at
--   packages/database/src/__tests__/force-rls-coverage.test.ts
-- parses every migration and asserts the invariant statically, so a
-- future migration that adds RLS without FORCE will fail CI.
