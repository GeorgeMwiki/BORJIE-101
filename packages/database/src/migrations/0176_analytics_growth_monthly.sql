-- =============================================================================
-- Migration 0176 — analytics_growth_monthly: operating-output + revenue trend.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner-portal AnalyticsGrowthPage (GET /api/v1/analytics/growth) returned
-- an empty series + `X-Backend-Status: degraded` because no growth read-model
-- existed. This adds it: one row per (tenant_id, period) — period = first UTC
-- day of the month — derived from the MINING domain
-- (sites → production_records → sales → ledger_entries):
--   active_sites        ← COUNT(sites active in the month)
--   production_kg       ← SUM(production_records.mass_kg) in the month
--   sales_count         ← COUNT(sales) in the month
--   revenue_minor_units ← SUM(ledger CREDIT lines settled in the month)
--   royalty_minor_units ← royalty accrued in the month
-- The consolidation-worker analytics-aggregate task UPSERTs into it; the
-- gateway reads REAL series and drops the degraded header.
--
-- MONEY MODEL (CLAUDE.md hard rule)
-- ---------------------------------
-- revenue/royalty are BIGINT minor units (integer minor units, BIGINT storage
-- so an accumulating monthly roll-up cannot overflow INTEGER — mirrors 0160).
-- `currency` (ISO-4217) is stored alongside so the renderer threads it into
-- formatCurrency(amount, code) — NEVER a hardcoded TZS/USD. production_kg is a
-- MEASURE (mass), not money, but is BIGINT to tolerate large summed masses.
--
-- HARD RULES HONOURED (CLAUDE.md)
-- -------------------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true). REVOKE anon (guarded).
--   * Idempotent re-run grain: UNIQUE (tenant_id, period) so the aggregator
--     UPSERTs without double-counting.
--   * This is a READ-MODEL of money totals — it stores NO posted ledger lines.
--     The money path itself stays on LedgerService.post(); this table only
--     SUMs the already-posted ledger_entries.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_growth_monthly (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  period               DATE NOT NULL,
  active_sites         INTEGER NOT NULL DEFAULT 0,
  production_kg        BIGINT  NOT NULL DEFAULT 0,
  sales_count          INTEGER NOT NULL DEFAULT 0,
  revenue_minor_units  BIGINT  NOT NULL DEFAULT 0,
  royalty_minor_units  BIGINT  NOT NULL DEFAULT 0,
  currency             TEXT    NOT NULL,
  attributes           JSONB   NOT NULL DEFAULT '{}'::jsonb,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent UPSERT grain — one row per (tenant, month).
CREATE UNIQUE INDEX IF NOT EXISTS analytics_growth_monthly_grain_uniq
  ON analytics_growth_monthly(tenant_id, period);

-- Read hot path: "this tenant's monthly trend" (newest first).
CREATE INDEX IF NOT EXISTS analytics_growth_monthly_tenant_period_idx
  ON analytics_growth_monthly(tenant_id, period);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'analytics_growth_monthly'
  ) THEN
    EXECUTE 'ALTER TABLE public.analytics_growth_monthly ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.analytics_growth_monthly FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'analytics_growth_monthly'
        AND policyname = 'analytics_growth_monthly_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY analytics_growth_monthly_tenant_isolation
        ON public.analytics_growth_monthly
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.analytics_growth_monthly FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE analytics_growth_monthly IS
  'Operating-output + revenue trend warehouse: one row per (tenant_id, period) '
  '(period = first UTC day of the month) derived from sites -> production_records '
  '-> sales -> ledger_entries. revenue/royalty are BIGINT minor units with an '
  'ISO-4217 currency column (never hardcoded). READ-MODEL only — it SUMs '
  'already-posted ledger_entries; the money path stays on LedgerService.post(). '
  'Populated by the consolidation-worker analytics-aggregate task (UPSERT on the '
  '(tenant_id, period) unique). Backs GET /api/v1/analytics/growth. Tenant-scoped '
  'FORCE RLS on app.current_tenant_id. Added in 0176.';

COMMIT;
