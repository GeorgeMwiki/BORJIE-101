-- ─────────────────────────────────────────────────────────────────────
-- Migration 0201 — Conversation threads (Piece F).
--
-- Per-(persona, project, channel) conversation thread. Distinct from
-- the legacy `threads` table (conversation.schema.ts → migration set
-- 0100ish): that one is a multi-persona handoff trace; THIS one is a
-- user-facing chat thread (sidebar list, fork, pin, archive).
--
-- For customer personas (power_tier = 5):
--   - project_id IS ALWAYS NULL
--   - one thread per (user × channel)
--   - `external_channel_session_id` anchors a WhatsApp 24h window;
--     if a new inbound arrives after the window closes, the runtime
--     generates a fresh id and continues the SAME thread, so the
--     conversational history is preserved while session billing is
--     correctly tracked.
--
-- For MD-tier personas (power_tier ≤ 3):
--   - project_id MAY be set (project-scoped thread)
--   - many threads per persona, fork supported
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_threads (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id                  TEXT REFERENCES conversation_projects(id) ON DELETE SET NULL,
  owner_user_id               TEXT NOT NULL REFERENCES users(id),
  owner_persona_id            TEXT NOT NULL REFERENCES personas(id),
  module_id                   TEXT,
  title                       TEXT NOT NULL DEFAULT 'New conversation',
  pinned                      BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at                 TIMESTAMPTZ,
  -- Forking: a thread created by branching from an existing message
  -- carries the source ids so the UI can render a tree.
  fork_of_thread_id           TEXT REFERENCES conversation_threads(id),
  fork_of_message_id          TEXT,
  -- Roots the message hash chain into the ai_audit_chain (Wave-11). The
  -- chain root hash is the first message's `prev_hash` value and is
  -- registered into ai_audit_chain on thread creation.
  message_chain_root_hash     TEXT,
  last_message_at             TIMESTAMPTZ,
  retention_policy_id         TEXT,
  -- Channel routing. The persona's channel_allowlist must contain this
  -- value or the runtime rejects the thread.
  channel                     TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'mobile', 'whatsapp', 'sms', 'voice')),
  -- For WhatsApp/SMS/voice: the upstream session id (Twilio call sid,
  -- Meta wa.session_id). The runtime stitches identity by user_id but
  -- bills/sessions are anchored here so a 24h-window rollover is
  -- represented without losing the conversational thread.
  external_channel_session_id TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_tenant
  ON conversation_threads (tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_owner
  ON conversation_threads (owner_user_id, owner_persona_id);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_project
  ON conversation_threads (project_id) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_threads_archived
  ON conversation_threads (archived_at) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_threads_last_msg
  ON conversation_threads (tenant_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_channel_session
  ON conversation_threads (external_channel_session_id)
  WHERE external_channel_session_id IS NOT NULL;

COMMENT ON TABLE conversation_threads IS
  'Piece F — user-facing chat threads. Distinct from the multi-persona handoff `threads` table; one thread per (persona, project, channel).';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversation_threads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'conversation_threads') THEN
    DROP POLICY IF EXISTS conversation_threads_tenant_isolation ON conversation_threads;
    CREATE POLICY conversation_threads_tenant_isolation ON conversation_threads
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS conversation_threads_tenant_isolation_write ON conversation_threads;
    CREATE POLICY conversation_threads_tenant_isolation_write ON conversation_threads
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
