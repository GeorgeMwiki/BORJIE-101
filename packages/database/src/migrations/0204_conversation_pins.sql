-- ─────────────────────────────────────────────────────────────────────
-- Migration 0204 — Conversation pins (Piece F).
--
-- Per-thread "saved references" — asset rows from `core_entity`,
-- external URLs, or short notes the user wants to surface at the top
-- of every retrieval. The brain reads pins as high-priority context.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_pins (
  id                          TEXT PRIMARY KEY,
  thread_id                   TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id),
  -- One of asset_id / url / note must be set. The application layer
  -- enforces this (the table is permissive so future pin kinds — files,
  -- attachments — can be added without a migration).
  asset_id                    TEXT,
  url                         TEXT,
  note                        TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_pins_tenant
  ON conversation_pins (tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversation_pins_thread
  ON conversation_pins (thread_id);

CREATE INDEX IF NOT EXISTS idx_conversation_pins_asset
  ON conversation_pins (asset_id) WHERE asset_id IS NOT NULL;

COMMENT ON TABLE conversation_pins IS
  'Piece F — per-thread pinned references (assets, URLs, notes) read as high-priority context.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS conversation_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversation_pins FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'conversation_pins') THEN
    DROP POLICY IF EXISTS conversation_pins_tenant_isolation ON conversation_pins;
    CREATE POLICY conversation_pins_tenant_isolation ON conversation_pins
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS conversation_pins_tenant_isolation_write ON conversation_pins;
    CREATE POLICY conversation_pins_tenant_isolation_write ON conversation_pins
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
