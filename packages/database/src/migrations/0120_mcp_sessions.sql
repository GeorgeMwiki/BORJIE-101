-- =============================================================================
-- Migration 0120 — MCP Sessions
--
-- Wave AGENTIC-PLATFORM. Persistent session state for the public MCP
-- server (services/mcp-server-borjie). Lets an external agent close +
-- reopen the SSE/stdio/http transport and resume the conversation with
-- the last 20 turns of context preserved.
--
-- Tables:
--   mcp_sessions — one row per agent session. Carries:
--     - state            — free-form JSON the client may push via
--                          session/setState
--     - conversation_summary
--                       — rolling LAST-20-turns capsule the dispatcher
--                          appends after each tools/call response
--     - last_activity_at
--                       — bumped by every dispatcher checkpoint
--     - expires_at      — 24h default TTL (refreshed on each touch)
--
-- RLS:
--   FORCE on. Policy isolates by token_id so an agent's sessions are
--   never visible across tenants — token_id transitively narrows to
--   oauth_agent_tokens.tenant_id (already FORCE-RLS scoped on the
--   parent table).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id              uuid        NOT NULL REFERENCES oauth_agent_tokens(id) ON DELETE CASCADE,
  state                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  conversation_summary  text,
  last_activity_at      timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_token_last_activity
  ON mcp_sessions (token_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_expiry
  ON mcp_sessions (expires_at);

ALTER TABLE mcp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_sessions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mcp_sessions'
       AND policyname = 'mcp_sessions_token_isolation'
  ) THEN
    CREATE POLICY mcp_sessions_token_isolation
      ON mcp_sessions
      FOR ALL
      USING (
        token_id IN (
          SELECT id FROM oauth_agent_tokens
           WHERE tenant_id = current_setting('app.current_tenant_id', true)
        )
      )
      WITH CHECK (
        token_id IN (
          SELECT id FROM oauth_agent_tokens
           WHERE tenant_id = current_setting('app.current_tenant_id', true)
        )
      );
  END IF;
END $$;

COMMIT;
