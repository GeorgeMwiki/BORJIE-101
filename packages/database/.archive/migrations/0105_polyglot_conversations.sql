-- =============================================================================
-- 0105: Polyglot conversations — any-language tenant support
-- =============================================================================
-- Tenant speaks/types in ANY language (auto-detected). Response is in the
-- detected language with fallback to English. Every turn persisted with
-- ISO-639-1/-2 language code. NEVER hardcoded en/sw.
-- =============================================================================

CREATE TABLE IF NOT EXISTS polyglot_conversations (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           TEXT,
  thread_id             TEXT NOT NULL,
  turn_index            INTEGER NOT NULL CHECK (turn_index >= 0),
  speaker               TEXT NOT NULL CHECK (speaker IN ('user', 'assistant', 'system')),
  detected_language     TEXT,                                   -- ISO-639
  response_language     TEXT,                                   -- ISO-639 (fallback to 'en')
  text                  TEXT NOT NULL,
  translation_en        TEXT,                                   -- optional EN mirror for audit
  model_version         TEXT,
  prompt_hash           TEXT,
  confidence            DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polyglot_conversations_thread
  ON polyglot_conversations (tenant_id, thread_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_polyglot_conversations_customer
  ON polyglot_conversations (tenant_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_polyglot_conversations_language
  ON polyglot_conversations (tenant_id, detected_language);
