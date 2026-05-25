-- Migration 0163 — Phase E + Phase F constraint follow-up (HIGH-D from
-- the 2026-05-18 post-Phase-F bug sweep).
--
-- Closes audit findings 7.1 / 7.2 / 7.3 / 7.4 / 7.5. The original
-- migrations 0160 (autonomy governance) + 0161 (mdr_plan) + 0162
-- (owner_skills) shipped without:
--
--   * RLS + tenant-isolation policies   → cross-tenant read risk
--   * Foreign keys                       → orphan rows possible
--   * CHECK constraints on enum-shaped TEXT columns → bad data lands
--   * TIMESTAMPTZ on time columns        → local-time drift across
--                                          replicas in different
--                                          server time zones
--
-- This migration is idempotent: every ALTER is guarded by an
-- existence / NOT-EXISTS check so partial runs are safe.

-- ============================================================================
-- 1. mdr_plan_items — FK + CHECK + RLS + TIMESTAMPTZ + self-cycle guard
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mdr_plan_items'
  ) THEN
    -- Foreign keys (idempotent — drop-if-exists then add).
    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_tenant_fk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_parent_fk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_parent_fk
        FOREIGN KEY (parent_id) REFERENCES public.mdr_plan_items(id) ON DELETE SET NULL;

    -- CHECK constraints on enum-shaped TEXT columns.
    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_horizon_chk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_horizon_chk
        CHECK (horizon IN ('annual', 'quarterly', 'monthly', 'weekly', 'daily'));

    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_status_chk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_status_chk
        CHECK (status IN ('proposed', 'active', 'paused', 'done', 'cancelled'));

    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_proposed_by_chk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_proposed_by_chk
        CHECK (proposed_by IN ('md', 'owner'));

    -- Self-cycle guard — a node can't be its own parent.
    ALTER TABLE public.mdr_plan_items
      DROP CONSTRAINT IF EXISTS mdr_plan_items_no_self_parent_chk;
    ALTER TABLE public.mdr_plan_items
      ADD  CONSTRAINT mdr_plan_items_no_self_parent_chk
        CHECK (parent_id IS DISTINCT FROM id);

    -- TIMESTAMPTZ — drop and re-add as TIMESTAMPTZ. Safe because no
    -- production data exists for this table yet (Phase E.7 — net-new).
    ALTER TABLE public.mdr_plan_items
      ALTER COLUMN accepted_at TYPE timestamptz USING accepted_at AT TIME ZONE 'UTC';
    ALTER TABLE public.mdr_plan_items
      ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE public.mdr_plan_items
      ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

    -- RLS — enable + force + tenant-isolation policies (mirror 0156).
    ALTER TABLE public.mdr_plan_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.mdr_plan_items FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation_select ON public.mdr_plan_items;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.mdr_plan_items;

    CREATE POLICY tenant_isolation_select ON public.mdr_plan_items
      FOR SELECT
      TO authenticated
      USING (tenant_id::text = public.current_app_tenant_id());

    CREATE POLICY tenant_isolation_modify ON public.mdr_plan_items
      FOR ALL
      TO authenticated
      USING (tenant_id::text = public.current_app_tenant_id())
      WITH CHECK (tenant_id::text = public.current_app_tenant_id());

    REVOKE ALL ON public.mdr_plan_items FROM anon;
  END IF;
END
$$;

-- ============================================================================
-- 2. owner_skills — FK + CHECK + RLS + TIMESTAMPTZ
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'owner_skills'
  ) THEN
    -- Foreign keys.
    ALTER TABLE public.owner_skills
      DROP CONSTRAINT IF EXISTS owner_skills_installer_fk;
    ALTER TABLE public.owner_skills
      ADD  CONSTRAINT owner_skills_installer_fk
        FOREIGN KEY (installed_by_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

    ALTER TABLE public.owner_skills
      DROP CONSTRAINT IF EXISTS owner_skills_author_fk;
    ALTER TABLE public.owner_skills
      ADD  CONSTRAINT owner_skills_author_fk
        FOREIGN KEY (author_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

    -- CHECK constraint on trigger_kind.
    ALTER TABLE public.owner_skills
      DROP CONSTRAINT IF EXISTS owner_skills_trigger_kind_chk;
    ALTER TABLE public.owner_skills
      ADD  CONSTRAINT owner_skills_trigger_kind_chk
        CHECK (trigger_kind IN ('cron', 'event', 'manual'));

    -- TIMESTAMPTZ migration.
    ALTER TABLE public.owner_skills
      ALTER COLUMN installed_at TYPE timestamptz USING installed_at AT TIME ZONE 'UTC';
    ALTER TABLE public.owner_skills
      ALTER COLUMN last_run_at TYPE timestamptz USING last_run_at AT TIME ZONE 'UTC';

    -- RLS — uses `installed_by_tenant_id` as the tenant column.
    ALTER TABLE public.owner_skills ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.owner_skills FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation_select ON public.owner_skills;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.owner_skills;

    CREATE POLICY tenant_isolation_select ON public.owner_skills
      FOR SELECT
      TO authenticated
      USING (installed_by_tenant_id::text = public.current_app_tenant_id());

    CREATE POLICY tenant_isolation_modify ON public.owner_skills
      FOR ALL
      TO authenticated
      USING (installed_by_tenant_id::text = public.current_app_tenant_id())
      WITH CHECK (installed_by_tenant_id::text = public.current_app_tenant_id());

    REVOKE ALL ON public.owner_skills FROM anon;
  END IF;
END
$$;

-- ============================================================================
-- 3. tenant_autonomy_caps + sub_md_slos + sub_md_slo_events — RLS
-- ============================================================================
-- 0160 created these tables with FK + CHECK on most columns already
-- (see migration 0160). What's missing is RLS — without it, any
-- application-side query that forgets the tenant filter is a
-- cross-tenant read. Closes audit finding 7.1.

DO $$
DECLARE
  tbl text;
  autonomy_tables text[] := ARRAY[
    'tenant_autonomy_caps',
    'sub_md_slos',
    'sub_md_slo_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY autonomy_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- For these tables, `tenant_id` can be NULL (platform-default
      -- rows in sub_md_slos). Allow NULL-tenant rows to be visible to
      -- everyone (they ARE the defaults), and tenant-scoped rows only
      -- to the matching tenant.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        );
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        )
        WITH CHECK (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        );
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 4. Operator note
-- ============================================================================
-- After this migration runs, `SELECT * FROM public.rls_coverage_audit;`
-- (view defined in 0155) should show `rls_forced = true` and
-- `policy_count >= 2` for all five tables touched above.

COMMENT ON CONSTRAINT mdr_plan_items_horizon_chk ON public.mdr_plan_items IS
  '0163 — horizon must be one of annual/quarterly/monthly/weekly/daily.';
COMMENT ON CONSTRAINT mdr_plan_items_status_chk ON public.mdr_plan_items IS
  '0163 — status must be one of proposed/active/paused/done/cancelled.';
COMMENT ON CONSTRAINT owner_skills_trigger_kind_chk ON public.owner_skills IS
  '0163 — trigger_kind must be one of cron/event/manual.';
