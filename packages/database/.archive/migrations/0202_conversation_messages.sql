-- ─────────────────────────────────────────────────────────────────────
-- Migration 0202 — Conversation messages (Piece F).
--
-- Append-only message log with SHA-256 hash chain (LITFIN-style). The
-- chain links each message to its parent via `prev_hash → hash`; a
-- single mutation breaks the chain on `verifyChain()`.
--
-- Hash computation (deterministic, JSON-stable):
--   hash = sha256(
--     prev_hash ||
--     thread_id ||
--     role ||
--     canonical_jsonb(content_jsonb) ||
--     created_at_iso
--   )
--
-- The first message in a thread uses the thread's
-- `message_chain_root_hash` (registered into ai_audit_chain at thread
-- creation) as `prev_hash`. Forks point `parent_message_id` at the
-- branch point but compute their own root hash from the fork moment.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                          TEXT PRIMARY KEY,
  thread_id                   TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id),
  parent_message_id           TEXT REFERENCES conversation_messages(id),
  role                        TEXT NOT NULL
    CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  -- Content envelope. Shape depends on role:
  --   user      → { type: 'text', text: '...' }
  --   assistant → { type: 'text', text: '...' } OR { type: 'tool_use', ... }
  --   tool      → { type: 'tool_result', tool_use_id, content }
  --   system    → { type: 'text', text: '...' }
  content_jsonb               JSONB NOT NULL,
  -- Optional tool-call envelope on assistant messages.
  tool_calls_jsonb            JSONB,
  -- IDs of artifacts produced by this message (versions in conversation_artifacts).
  artifact_ref_ids            TEXT[],
  -- IDs of action plans this message proposed (in core action-plan store).
  action_plan_ids             TEXT[],
  -- Pinned asset references (core_entity.id values).
  asset_refs                  TEXT[],
  prev_hash                   TEXT,
  hash                        TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
  ON conversation_messages (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_tenant
  ON conversation_messages (tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_parent
  ON conversation_messages (parent_message_id) WHERE parent_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_messages_hash
  ON conversation_messages (hash);

COMMENT ON TABLE conversation_messages IS
  'Piece F — append-only chat message log with SHA-256 hash chain. Mutation breaks the chain on verify.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversation_messages FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'conversation_messages') THEN
    DROP POLICY IF EXISTS conversation_messages_tenant_isolation ON conversation_messages;
    CREATE POLICY conversation_messages_tenant_isolation ON conversation_messages
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS conversation_messages_tenant_isolation_write ON conversation_messages;
    CREATE POLICY conversation_messages_tenant_isolation_write ON conversation_messages
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
