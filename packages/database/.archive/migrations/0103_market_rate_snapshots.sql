-- =============================================================================
-- 0103: Market-rate surveillance snapshots
-- =============================================================================
-- Daily per-unit comparable-rent rolling percentile band.
-- Fed by the MarketRatePort abstraction — concrete scrapers / data vendors
-- are adapters (stubbed behind env vars). Currency is ISO-4217; every row
-- records its source & sample size so downstream drift detection can trust.
-- =============================================================================

CREATE TABLE IF NOT EXISTS market_rate_snapshots (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                 TEXT NOT NULL,
  property_id             TEXT,
  currency_code           TEXT NOT NULL,                        -- ISO-4217
  our_rent_amount_minor   BIGINT NOT NULL,                      -- stored in minor units
  market_median_minor     BIGINT,
  market_p25_minor        BIGINT,
  market_p75_minor        BIGINT,
  market_sample_size      INTEGER NOT NULL DEFAULT 0 CHECK (market_sample_size >= 0),
  delta_pct               DOUBLE PRECISION,                     -- (our - median) / median
  drift_flag              TEXT CHECK (
                            drift_flag IS NULL OR drift_flag IN ('below_market', 'above_market', 'on_band')
                          ),
  comp_radius_km          DOUBLE PRECISION,
  source_adapter          TEXT NOT NULL,                        -- adapter id used
  source_metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version           TEXT NOT NULL,
  prompt_hash             TEXT,                                 -- if LLM-extracted
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_rate_snapshots_tenant_unit_time
  ON market_rate_snapshots (tenant_id, unit_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_rate_snapshots_drift
  ON market_rate_snapshots (tenant_id, drift_flag, observed_at DESC)
  WHERE drift_flag IS NOT NULL AND drift_flag <> 'on_band';
