-- =============================================================================
-- 0182: section_layouts — adaptive-layout persistence mirror.
--
-- Backs the adaptive layout engine in
-- `packages/dynamic-sections/src/lib/adaptive-layout`. The engine is
-- a pure, deterministic function; this table stores the resolved
-- section ordering whenever a user explicitly reorders / pins / hides
-- a section so a returning user lands on the same surface they
-- configured.
--
-- Composite primary key (tenant_id, user_id, route) — three
-- independent surfaces (owner.dashboard / tenant.dashboard /
-- admin.dashboard) get independent layouts per user.
--
-- RLS policy pattern mirrors migration 0166b_rls_promote_out_wave.sql
-- and 0169b_payments_ledger_rls.sql:
--   * ENABLE ROW LEVEL SECURITY
--   * FORCE ROW LEVEL SECURITY
--   * tenant_isolation_select policy (USING)
--   * tenant_isolation_modify policy (FOR ALL, USING + WITH CHECK)
--   * REVOKE ALL FROM anon
--
-- The tenant predicate uses `public.current_app_tenant_id()` — the
-- canonical helper installed by migration 0172 that reads the
-- `app.current_tenant_id` GUC with a legacy `app.tenant_id` fallback.
--
-- Idempotent: every operation gated on table/index/policy existence,
-- safe to re-run on a fresh database.
--
-- Array variable name (`tenant_tables`) matches the
-- audit-rls-coverage scanner expectation so the loop-installed
-- policies are picked up by CI.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create table + indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_layouts (
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  /** Route key (e.g. 'owner.dashboard', 'tenant.payments'). */
  route           TEXT NOT NULL,
  /** JSONB-encoded SectionId[] — the resolved section ordering. */
  section_order   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Explicit user pins — TEXT[] so PG contains/overlap is cheap. */
  pinned          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /** Explicit user hides. */
  hidden          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /** Snapshot metadata: intent at last update, frustration snapshot, rationale, … */
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, route)
);

CREATE INDEX IF NOT EXISTS section_layouts_tenant_route_idx
  ON section_layouts (tenant_id, route);

CREATE INDEX IF NOT EXISTS section_layouts_tenant_user_updated_idx
  ON section_layouts (tenant_id, user_id, last_updated);

COMMENT ON TABLE section_layouts IS
  'Adaptive-layout persistence mirror. Per-(tenant, user, route) section ordering plus explicit pin/hide overrides. Mirrors the output of the dynamic-sections adaptive-layout engine. Tenant-scoped RLS via current_app_tenant_id() GUC helper.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ENABLE + FORCE RLS, install tenant-isolation policies.
--    Pattern from 0166b_rls_promote_out_wave.sql.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'section_layouts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Enable + force RLS (idempotent).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical names.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT/UPDATE/DELETE. section_layouts rows
      -- get updated frequently (every layout change persists a row),
      -- so FOR ALL is correct.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: this is an additive migration. No backfill required —
-- the engine writes a section_layouts row only on explicit user
-- reorder / pin / hide. Existing users continue to receive a freshly-
-- computed layout from the in-memory engine until they first interact.
