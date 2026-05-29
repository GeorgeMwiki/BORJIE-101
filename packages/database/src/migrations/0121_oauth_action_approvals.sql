-- =============================================================================
-- Migration 0121 — OAuth Action Approvals (Four-Eye Gate)
--
-- Wave AGENTIC-PLATFORM. Backs the four-eye approval gate on the public
-- MCP server. Tool names matching the HIGH-risk prefixes
--
--   kill_switch.*  | four_eye.*  |  sovereign.*  |  policy_rollout.*
--
-- MUST be confirmed by the owner before they execute. Each call lands
-- a pending row here and the dispatcher returns
-- `{ status: "pending_approval", approval_url, expires_in }` so the
-- agent can either:
--   - poll `actions/approval_status` for the row id, or
--   - park the conversation and resume after the owner approves.
--
-- Lifecycle:
--   pending  -> approved  -> consumed
--   pending  -> denied
--   pending  -> expired
--
-- RLS:
--   FORCE on. Policy isolates by token_id (which is in turn tenant-
--   scoped via oauth_agent_tokens.tenant_id), so an agent can only
--   ever see its own approvals.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS oauth_action_approvals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id        uuid        NOT NULL REFERENCES oauth_agent_tokens(id) ON DELETE CASCADE,
  tool_name       text        NOT NULL,
  arguments       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  approved_at     timestamptz,
  approved_by     text        REFERENCES users(id) ON DELETE SET NULL,
  denied_at       timestamptz,
  consumed_at     timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oauth_action_approvals_status_chk'
  ) THEN
    ALTER TABLE oauth_action_approvals
      ADD CONSTRAINT oauth_action_approvals_status_chk
      CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oauth_action_approvals_token_pending
  ON oauth_action_approvals (token_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_oauth_action_approvals_expiry
  ON oauth_action_approvals (expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_oauth_action_approvals_tool_status
  ON oauth_action_approvals (tool_name, status);

ALTER TABLE oauth_action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_action_approvals FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'oauth_action_approvals'
       AND policyname = 'oauth_action_approvals_token_isolation'
  ) THEN
    CREATE POLICY oauth_action_approvals_token_isolation
      ON oauth_action_approvals
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
