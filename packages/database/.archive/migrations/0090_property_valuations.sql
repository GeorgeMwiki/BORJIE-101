-- =============================================================================
-- 0090: Property Valuations
-- =============================================================================
-- Backs `live-metrics-source.fetchPortfolioWeightHints()` in the property-
-- grading service. The service already handles a missing table gracefully
-- (equal-weighting fallback), but a real table lets appraisals feed into
-- portfolio-weighted grade rollups without that silent degradation.
--
-- Additive & idempotent — no destructive changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS property_valuations (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id         TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Valuation amount, minor units (cents).
  amount_minor_units  BIGINT NOT NULL,
  currency            TEXT NOT NULL,

  -- Source of the valuation: 'appraisal' | 'market_comp' | 'self_reported'
  -- | 'purchase_price' | 'insurance' | 'other'. Free-form so the app layer
  -- can extend without a schema migration.
  source              TEXT NOT NULL DEFAULT 'appraisal',
  appraiser_name      TEXT,
  report_url          TEXT,

  -- When the valuation was taken. live-metrics-source orders DESC on this
  -- column to pick the most recent per property.
  valued_at           TIMESTAMPTZ NOT NULL,

  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,
  updated_by          TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_valuations_tenant_property
  ON property_valuations(tenant_id, property_id, valued_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_valuations_latest
  ON property_valuations(tenant_id, valued_at DESC);
