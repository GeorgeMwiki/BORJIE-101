-- =============================================================================
-- 0056: AI background insights \u2014 Wave-11 OpenClaw port
-- =============================================================================
-- Structured insights produced by background tasks running on a schedule even
-- when no user is logged in. The nightly portfolio scan, arrears ladder tick,
-- renewal proposal generator, FAR inspection sweep, compliance expiry check,
-- monthly cost rollup, weekly vendor digest, and weekly 5Ps recompute all
-- write rows here.
--
-- Dedupe key ensures a single underlying situation (e.g. one arrears case at
-- one ladder step) does not produce duplicates across scheduler ticks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_background_insights (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  severity          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_plan       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_background_insights_dedupe
  ON ai_background_insights(tenant_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_ai_background_insights_tenant_created
  ON ai_background_insights(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_background_insights_tenant_unacked
  ON ai_background_insights(tenant_id) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_background_insights_kind
  ON ai_background_insights(tenant_id, kind);
