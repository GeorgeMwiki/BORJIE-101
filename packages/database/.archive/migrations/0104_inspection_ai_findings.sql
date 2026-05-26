-- =============================================================================
-- 0104: Multimodal inspection AI findings
-- =============================================================================
-- Each inspection may generate many per-finding rows after the multimodal
-- call (vision model analyses photo/video/audio). Bounding boxes are stored
-- as normalized [x,y,w,h] arrays so UIs can draw overlays.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inspection_ai_findings (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id         TEXT NOT NULL,
  defect_label          TEXT NOT NULL,
  severity              TEXT NOT NULL CHECK (
                          severity IN ('cosmetic', 'minor', 'moderate', 'major', 'critical')
                        ),
  estimated_cost_min_minor BIGINT,
  estimated_cost_max_minor BIGINT,
  currency_code         TEXT,                                   -- ISO-4217
  recommended_trade     TEXT,                                   -- 'plumber' | 'electrician' | ...
  evidence_media_id     TEXT,
  bounding_box          JSONB,                                  -- [x, y, w, h] normalized [0,1]
  confidence            DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  model_version         TEXT NOT NULL,
  prompt_hash           TEXT NOT NULL,
  explanation           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_ai_findings_inspection
  ON inspection_ai_findings (tenant_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_ai_findings_severity
  ON inspection_ai_findings (tenant_id, severity)
  WHERE severity IN ('major', 'critical');
