-- =============================================================================
-- 0265: spawn_detector_state — Piece O cron state per tenant.
--
-- The need-detection cron (`packages/tab-need-detector/src/cron.ts`)
-- runs every N hours per tenant. It needs to know:
--   * last_scan_at — so the next scan only looks at fresh signals,
--   * total_signals_scanned / total_proposals_emitted — for observability,
--   * config_jsonb — per-tenant thresholds (default score 5.0, decline
--     snooze 30d, expiry window 14d, half-life 7d).
--
-- One row per tenant. Cron upserts on each run.
--
-- This migration:
--   1. Creates `spawn_detector_state` table — PK is tenant_id (one row
--      per tenant, hard-bound via FK CASCADE).
--   2. GOLD-STANDARD RLS via `public.current_app_tenant_id()` (0172).
--      Note: cron runs as service-role which bypasses RLS, so this is
--      defence-in-depth.
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spawn_detector_state (
  tenant_id                  TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_scan_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_signals_scanned      BIGINT NOT NULL DEFAULT 0,
  total_proposals_emitted    BIGINT NOT NULL DEFAULT 0,
  /**
   * Per-tenant config. Default merged with code defaults from
   * `packages/tab-need-detector/src/scoring-matrix.ts`. Keys:
   *   - score_threshold (number, default 5.0)
   *   - decline_snooze_days (number, default 30)
   *   - proposal_expiry_days (number, default 14)
   *   - signal_half_life_days (number, default 7)
   *   - lookback_days (number, default 14)
   *   - scan_interval_hours (number, default 6)
   */
  config_jsonb               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE spawn_detector_state IS
  'Piece O — per-tenant cron state for need-detection. One row per tenant. Cron upserts on each scan cycle.';

COMMENT ON COLUMN spawn_detector_state.config_jsonb IS
  'Per-tenant overrides: score_threshold, decline_snooze_days, proposal_expiry_days, signal_half_life_days, lookback_days, scan_interval_hours. Merged with code defaults.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'spawn_detector_state'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
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

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: cron writes are service-role, so RLS bypass is the norm.
-- The policies exist as defence-in-depth in case future admin UI surfaces
-- read this table via the authenticated role.
