-- =============================================================================
-- Migration 0067 — Forecast Runs (SOTA-FORECAST wave)
--
-- Companion to Docs/DESIGN/FORECASTING_SOTA_2026.md and the SOTA layer in
-- @borjie/forecasting (src/sota/).
--
-- Persona: Mr. Mwikila. He runs gold-price, production-volume, royalty,
-- demand, workforce, and fuel-cost forecasts daily; every run is persisted
-- here so the operator can replay the exact forecast that justified
-- locking an off-take price, raising royalty cash, or sizing the next
-- shift cycle.
--
-- One table:
--
--   forecast_runs — one row per persisted forecast. Carries the point
--                   forecast + 80 % and 95 % prediction intervals as
--                   jsonb, the in-sample / walk-forward metrics, and a
--                   PO-14 audit-chain link (audit_hash, prev_hash) so a
--                   tenant's forecast history is tamper-evident.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- forecast_runs — every SOTA forecast Mr. Mwikila persists
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forecast_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  /** Forecast target. One of:
        'gold_price'         — daily LME / Kitco-derived gold price
        'production_volume'  — per-pit daily tonnes ore
        'royalty'            — monthly TRA royalty + clearing-fee revenue
        'demand'             — weekly off-take partner demand
        'workforce'          — weekly worker headcount target
        'fuel'               — daily diesel cost
  */
  target           text NOT NULL,
  /** Number of frequency-steps ahead this forecast covers (1 = next bucket). */
  horizon          integer NOT NULL,
  /** Model identifier. Singletons: 'timegpt' | 'chronos' | 'moirai' |
      'prophet' | 'arima' | 'nbeats' | 'naive-seasonal' | 'naive-last' |
      'naive-mean'. Ensembles: 'ensemble:<spec>' where <spec> is the
      sorted, comma-separated set of constituents. */
  model            text NOT NULL,
  /** Per-step point forecast — JSON array of numbers, length = horizon. */
  point_forecast   jsonb NOT NULL,
  /** Per-step 80 % prediction interval. Shape:
        [{ "step": 1, "lower": 1234.5, "upper": 1456.7 }, ...] */
  intervals_80     jsonb NOT NULL,
  /** Per-step 95 % prediction interval. Same shape as intervals_80. */
  intervals_95     jsonb NOT NULL,
  /** Walk-forward metrics from the most recent backtest split.
      Keys: { mae, mape, smape, rmse, mase, owa, wql }. */
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  /** PO-14 audit chain. */
  prev_hash        text NOT NULL DEFAULT '',
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_target_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_target_chk
      CHECK (target IN (
        'gold_price',
        'production_volume',
        'royalty',
        'demand',
        'workforce',
        'fuel'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_horizon_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_horizon_chk
      CHECK (horizon BETWEEN 1 AND 1000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_model_nonempty_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_model_nonempty_chk
      CHECK (length(model) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_point_is_array_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_point_is_array_chk
      CHECK (jsonb_typeof(point_forecast) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_intervals_80_is_array_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_intervals_80_is_array_chk
      CHECK (jsonb_typeof(intervals_80) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forecast_runs_intervals_95_is_array_chk'
  ) THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_intervals_95_is_array_chk
      CHECK (jsonb_typeof(intervals_95) = 'array');
  END IF;
END $$;

-- Hot path: list a tenant's recent forecasts for a given target.
CREATE INDEX IF NOT EXISTS idx_forecast_runs_tenant_target_ranat
  ON forecast_runs (tenant_id, target, ran_at DESC);

-- Model-comparison path: filter by model within a tenant.
CREATE INDEX IF NOT EXISTS idx_forecast_runs_tenant_model
  ON forecast_runs (tenant_id, model);

-- Forensic replay path.
CREATE INDEX IF NOT EXISTS idx_forecast_runs_audit_hash
  ON forecast_runs (audit_hash);

ALTER TABLE forecast_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'forecast_runs'
       AND policyname = 'forecast_runs_tenant_isolation'
  ) THEN
    CREATE POLICY forecast_runs_tenant_isolation
      ON forecast_runs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
