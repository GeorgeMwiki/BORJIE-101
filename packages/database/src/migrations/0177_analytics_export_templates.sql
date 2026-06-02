-- =============================================================================
-- Migration 0177 — analytics_export_templates: saved tenant export definitions.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner-portal AnalyticsExportsPage (GET /api/v1/analytics/exports/templates)
-- returned an empty list + `X-Backend-Status: degraded` because no export-template
-- store existed. This adds it: a tenant-authored, reusable export definition
-- (e.g. "monthly royalty return CSV"). `kind` is the export family
-- (csv|xlsx|pdf|json); `schema` is the column/filter spec the export engine
-- consumes. The gateway lists these scoped to tenant and drops the degraded
-- header.
--
-- HARD RULES HONOURED (CLAUDE.md)
-- -------------------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true). REVOKE anon (guarded).
--   * NO money columns — this is export configuration metadata only.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_export_templates (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'csv',
  schema       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Read hot path: "this tenant's templates" (newest first).
CREATE INDEX IF NOT EXISTS analytics_export_templates_tenant_idx
  ON analytics_export_templates(tenant_id, created_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'analytics_export_templates'
  ) THEN
    EXECUTE 'ALTER TABLE public.analytics_export_templates ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.analytics_export_templates FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'analytics_export_templates'
        AND policyname = 'analytics_export_templates_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY analytics_export_templates_tenant_isolation
        ON public.analytics_export_templates
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.analytics_export_templates FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE analytics_export_templates IS
  'Saved tenant export definitions: a reusable export spec (kind = '
  'csv|xlsx|pdf|json; schema = column/filter spec the export engine consumes). '
  'Backs GET /api/v1/analytics/exports/templates. NO money columns — config '
  'metadata only. Tenant-scoped FORCE RLS on app.current_tenant_id. Added in 0177.';

COMMIT;
