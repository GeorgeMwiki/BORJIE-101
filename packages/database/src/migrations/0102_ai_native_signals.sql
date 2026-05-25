-- =============================================================================
-- 0102: AI-Native Signals (continuous portfolio-wide sentiment monitor)
-- =============================================================================
-- Agent PhG — every message / complaint / feedback row is classified by an
-- LLM for sentiment, emotion, churn-signal, liability-signal, fraud-signal.
-- Rows are append-only; downstream readers aggregate rolling sentiment per
-- tenant and per customer.
--
-- Language is stored as ISO-639-1/-2 code — NEVER hardcoded en/sw pairs.
-- Scores are in [-1, 1] for sentiment and [0, 1] for classification signals.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_native_signals (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT,
  source_type         TEXT NOT NULL CHECK (
                        source_type IN ('message', 'complaint', 'feedback', 'inspection_note', 'case_note', 'other')
                      ),
  source_id           TEXT NOT NULL,
  language_code       TEXT,                                    -- ISO-639-1/-2, LLM-detected
  sentiment_score     DOUBLE PRECISION NOT NULL,               -- -1..1
  emotion_label       TEXT,                                    -- 'anger' | 'joy' | 'frustration' | ...
  churn_signal        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (churn_signal BETWEEN 0 AND 1),
  liability_signal    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (liability_signal BETWEEN 0 AND 1),
  fraud_signal        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (fraud_signal BETWEEN 0 AND 1),
  raw_excerpt         TEXT,
  model_version       TEXT NOT NULL,
  prompt_hash         TEXT NOT NULL,                           -- reproducibility audit
  confidence          DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  explanation         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_native_signals_tenant_time
  ON ai_native_signals (tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_native_signals_customer_time
  ON ai_native_signals (tenant_id, customer_id, observed_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_native_signals_source
  ON ai_native_signals (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_native_signals_sentiment
  ON ai_native_signals (tenant_id, sentiment_score)
  WHERE sentiment_score < 0;

-- rolling sentiment aggregate snapshot (materialized computation target; we
-- keep the raw table + an optional snapshot here so downstream readers pick
-- whichever is freshest)
CREATE TABLE IF NOT EXISTS ai_native_sentiment_rollups (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT,
  window_hours        INTEGER NOT NULL CHECK (window_hours > 0),
  avg_sentiment       DOUBLE PRECISION NOT NULL,
  sample_count        INTEGER NOT NULL CHECK (sample_count >= 0),
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_native_sentiment_rollups_tenant
  ON ai_native_sentiment_rollups (tenant_id, observed_at DESC);
