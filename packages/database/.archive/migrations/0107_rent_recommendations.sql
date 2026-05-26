-- =============================================================================
-- 0107: Dynamic rent recommendations (Agent PhL — AI-native dynamic pricing)
-- =============================================================================
-- Per-unit rent recommendations produced by an LLM-driven pricing loop that
-- combines market-rate snapshots, occupancy history, seasonality, inspection
-- grade, and churn predictions. Each row is a PROPOSAL — never auto-applied.
-- The ApprovalService consumes these rows and routes them through autonomy
-- thresholds so the owner retains final authority.
--
-- Citation discipline: every row lists the signals that drove the proposal
-- (market_rate_snapshot id, occupancy rollup hash, churn prediction id) so
-- every price has an audit trail.
--
-- Rent-control guardrail: if the tenant's jurisdiction plugin declares a
-- `rentIncreaseCap`, the proposer clamps `recommended_rent_minor` below that
-- cap and records the cap in `regulatory_cap_pct`. `cap_breached = TRUE`
-- means the raw LLM proposal exceeded the cap and was clamped.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rent_recommendations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                   TEXT NOT NULL,
  property_id               TEXT,
  currency_code             TEXT NOT NULL,                      -- ISO-4217
  current_rent_minor        BIGINT NOT NULL,                    -- what the unit rents for today
  recommended_rent_minor    BIGINT NOT NULL,                    -- proposed new rent (already clamped)
  delta_pct                 DOUBLE PRECISION NOT NULL,          -- (new - current)/current
  confidence                DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  suggested_review_date     DATE NOT NULL,

  -- Signal citations (what drove the proposal)
  market_signal_id          TEXT,                               -- FK-like to market_rate_snapshots.id (loose)
  occupancy_signal_ref      TEXT,                               -- hash of occupancy rollup window
  churn_signal_id           TEXT,                               -- FK-like to tenant_predictions.id
  inspection_signal_id      TEXT,                               -- FK-like to inspection_ai_findings.id
  seasonality_month         INTEGER,                            -- 1-12, nullable
  citations                 JSONB NOT NULL DEFAULT '[]'::jsonb, -- free-form citation list

  -- Regulatory guardrail audit
  regulatory_cap_pct        DOUBLE PRECISION,                   -- NULL = no cap in jurisdiction
  cap_breached              BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE if raw LLM exceeded cap

  -- LLM provenance (AI-limits, not human-limits)
  model_version             TEXT NOT NULL,
  prompt_hash               TEXT NOT NULL,
  explanation               TEXT NOT NULL,

  -- Approval routing
  approval_request_id       TEXT,                               -- set once queued into ApprovalService
  status                    TEXT NOT NULL DEFAULT 'proposed' CHECK (
                              status IN ('proposed', 'queued', 'approved', 'rejected', 'superseded', 'expired')
                            ),

  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_recommendations_tenant_unit
  ON rent_recommendations (tenant_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_recommendations_status
  ON rent_recommendations (tenant_id, status, suggested_review_date);
CREATE INDEX IF NOT EXISTS idx_rent_recommendations_cap_breach
  ON rent_recommendations (tenant_id, cap_breached)
  WHERE cap_breached = TRUE;
