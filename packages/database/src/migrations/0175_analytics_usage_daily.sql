-- =============================================================================
-- Migration 0175 — analytics_usage_daily: feature-usage warehouse.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner-portal AnalyticsUsagePage (GET /api/v1/analytics/usage) previously
-- returned an empty series + `X-Backend-Status: degraded` because no usage
-- warehouse existed. This adds the read-model: one row per (tenant_id, day,
-- dimension), where `dimension` is an `audit_events` category/action bucket
-- and `count` is the number of matching events for that bucket on that UTC
-- day. The consolidation-worker analytics-aggregate task UPSERTs into it from
-- `audit_events`; the gateway reads REAL series and drops the degraded header.
--
-- HARD RULES HONOURED (CLAUDE.md)
-- -------------------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0160/0171's
--     CORRECT GUC; never the legacy app.tenant_id). REVOKE anon (guarded for
--     vanilla PG / CI empty-PG).
--   * Idempotent re-run grain: UNIQUE (tenant_id, day, dimension) so the
--     aggregator can UPSERT without double-counting on a re-run.
--   * NO money columns — this is a usage-count warehouse.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_usage_daily (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  day          DATE NOT NULL,
  dimension    TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent UPSERT grain — one bucket per (tenant, day, dimension).
CREATE UNIQUE INDEX IF NOT EXISTS analytics_usage_daily_grain_uniq
  ON analytics_usage_daily(tenant_id, day, dimension);

-- Read hot path: "this tenant's series over a date range" (newest first).
CREATE INDEX IF NOT EXISTS analytics_usage_daily_tenant_day_idx
  ON analytics_usage_daily(tenant_id, day);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'analytics_usage_daily'
  ) THEN
    EXECUTE 'ALTER TABLE public.analytics_usage_daily ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.analytics_usage_daily FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'analytics_usage_daily'
        AND policyname = 'analytics_usage_daily_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY analytics_usage_daily_tenant_isolation
        ON public.analytics_usage_daily
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.analytics_usage_daily FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE analytics_usage_daily IS
  'Feature-usage warehouse: one row per (tenant_id, day, dimension) where '
  'dimension is an audit_events category/action bucket and count is the number '
  'of matching events that UTC day. Populated by the consolidation-worker '
  'analytics-aggregate task (UPSERT on the (tenant_id, day, dimension) unique). '
  'Backs GET /api/v1/analytics/usage. NO money columns. Tenant-scoped FORCE RLS '
  'on app.current_tenant_id. Added in 0175.';

COMMIT;
