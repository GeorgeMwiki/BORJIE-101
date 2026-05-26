-- =============================================================================
-- Migration 0033 — MCP external connections + tool-invocation audit
--                (Wave 18BB-MCP-EXT — founder gap analysis P0 #4)
--
-- Spec: Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md
--
-- Borjie publishes three internal MCP servers (`services/mcp-server-tra`,
-- `services/mcp-server-tumemadini`, `services/mcp-server-process-intel`)
-- but the kernel cannot *consume* from the wider MCP ecosystem
-- (10,000+ public servers — Slack, GitHub, Notion, GDrive, …). This
-- migration adds the persistence layer for the inverse arrow: the
-- `packages/agent-platform/src/mcp-external-client/` connects to public
-- MCP servers, lists their tools, and dispatches kernel calls into
-- them.
--
-- Two tables:
--   1. mcp_external_connections — per-tenant connection records
--                                  + encrypted credentials (OAuth tokens
--                                  / API keys), one row per
--                                  (tenant_id, server_id).
--   2. mcp_tool_invocations     — per-invocation audit log, links into
--                                  the existing ai_audit_chain hash
--                                  chain via `audit_chain_id`.
--
-- Both tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from
-- migration 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. mcp_external_connections — per-tenant connection records
-- -----------------------------------------------------------------------------
--
-- One row per (tenant_id, server_id). `encrypted_credentials` is AES-GCM
-- ciphertext, sealed with a tenant-bound DEK from KMS — the app layer
-- (mcp-external-client/auth/oauth-token-manager.ts) is the only code path
-- that decrypts it. `last_refreshed_at` powers the 5-minute safety
-- margin; `expires_at` is denormalised from the OAuth token for index
-- predicates.

CREATE TABLE IF NOT EXISTS mcp_external_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text NOT NULL,
  server_id              text NOT NULL,
  display_name           text NOT NULL,
  transport              text NOT NULL,
  auth_mode              text NOT NULL,
  encrypted_credentials  bytea,
  scopes                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at             timestamptz,
  last_refreshed_at      timestamptz,
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text,
  CONSTRAINT mcp_external_connections_tenant_server_uq
    UNIQUE (tenant_id, server_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mcp_external_connections_transport_chk'
  ) THEN
    ALTER TABLE mcp_external_connections
      ADD CONSTRAINT mcp_external_connections_transport_chk
      CHECK (transport IN ('stdio', 'sse', 'http'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mcp_external_connections_auth_chk'
  ) THEN
    ALTER TABLE mcp_external_connections
      ADD CONSTRAINT mcp_external_connections_auth_chk
      CHECK (auth_mode IN ('none', 'api_key', 'oauth_token', 'oauth_pkce'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_conn_tenant
  ON mcp_external_connections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_mcp_conn_expiry
  ON mcp_external_connections (tenant_id, expires_at)
  WHERE enabled = true AND expires_at IS NOT NULL;

ALTER TABLE mcp_external_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_external_connections_tenant_rls
  ON mcp_external_connections;
CREATE POLICY mcp_external_connections_tenant_rls
  ON mcp_external_connections
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE mcp_external_connections IS
  'Wave 18BB-MCP-EXT — per-tenant connection records for public MCP servers (Slack, GitHub, Notion, …). encrypted_credentials is AES-GCM ciphertext sealed with a tenant-bound DEK.';

-- -----------------------------------------------------------------------------
-- 2. mcp_tool_invocations — per-invocation audit log
-- -----------------------------------------------------------------------------
--
-- Every external MCP tool call lands here *and* a corresponding link is
-- appended to ai_audit_chain (the tamper-evident hash chain from
-- Wave 11). `audit_chain_id` lets a reviewer cross-walk the two.
-- `input_hash` and `output_hash` are SHA-256 of the canonicalised
-- payloads — we store the hashes (not the bodies) so PII never bleeds
-- into a long-lived audit table.

CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  connection_id     uuid NOT NULL
                       REFERENCES mcp_external_connections(id)
                       ON DELETE CASCADE,
  tool_name         text NOT NULL,
  correlation_id    text,
  audit_chain_id    text,
  input_hash        text NOT NULL,
  output_hash       text NOT NULL,
  outcome           text NOT NULL,
  error_message     text,
  tier              smallint NOT NULL,
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL,
  duration_ms       integer GENERATED ALWAYS AS
                       (EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)
                       STORED,
  CONSTRAINT mcp_tool_invocations_outcome_chk
    CHECK (outcome IN ('ok', 'error')),
  CONSTRAINT mcp_tool_invocations_tier_chk
    CHECK (tier IN (0, 1, 2)),
  CONSTRAINT mcp_tool_invocations_finished_after_started_chk
    CHECK (finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_mcp_inv_tenant_started
  ON mcp_tool_invocations (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_inv_connection
  ON mcp_tool_invocations (connection_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_inv_correlation
  ON mcp_tool_invocations (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_inv_errors
  ON mcp_tool_invocations (tenant_id, started_at DESC)
  WHERE outcome = 'error';

ALTER TABLE mcp_tool_invocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tool_invocations_tenant_rls
  ON mcp_tool_invocations;
CREATE POLICY mcp_tool_invocations_tenant_rls
  ON mcp_tool_invocations
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE mcp_tool_invocations IS
  'Wave 18BB-MCP-EXT — per-invocation audit log for external MCP tool calls. input_hash + output_hash are SHA-256; bodies are NOT stored to keep PII off this long-lived table.';

COMMIT;
