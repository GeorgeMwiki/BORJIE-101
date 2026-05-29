-- =============================================================================
-- Migration 0118 — OAuth Agent Tokens + Device Codes
--
-- Wave AGENTIC-PLATFORM. Adds the two tables that back the OAuth2 device
-- authorization grant (RFC 8628) flow Borjie uses to mint per-agent
-- access tokens for external MCP / CLI / SDK consumers.
--
--   oauth_device_codes  — short-lived pending grants. A device requests
--                          one via POST /oauth/device/code; the owner
--                          approves or denies via the owner-web consent UI.
--                          Polled by the device on POST /oauth/token.
--
--   oauth_agent_tokens  — long-lived per-agent access tokens. Hashed at
--                          rest (SHA-256). Tenant + user scoped. Carries
--                          a scope array (owner:read / owner:write / ...).
--                          Revocation is non-destructive (revoked_at).
--
-- IDs / refs:
--   - tenants.id  is `text` (see schemas/tenant.schema.ts) — we follow.
--   - users.id    is `text` — we follow.
--
-- RLS:
--   - oauth_agent_tokens   — FORCE on tenant_id GUC predicate (canonical
--     `current_setting('app.current_tenant_id', true)`).
--   - oauth_device_codes   — FORCE; predicate allows `tenant_id IS NULL`
--     during the pending phase (before the owner has approved + bound the
--     row to a tenant). Once approved, tenant_id is set and the predicate
--     narrows to that tenant.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this
-- file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- oauth_device_codes — pending device-flow grants
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code  text        PRIMARY KEY,
  user_code    text        NOT NULL UNIQUE,
  client_id    text        NOT NULL,
  client_label text,
  scopes       text[]      NOT NULL DEFAULT '{}',
  tenant_id    text        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      text        REFERENCES users(id)   ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending',
  expires_at   timestamptz NOT NULL,
  approved_at  timestamptz,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oauth_device_codes_status_chk'
  ) THEN
    ALTER TABLE oauth_device_codes
      ADD CONSTRAINT oauth_device_codes_status_chk
      CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_user_code_pending
  ON oauth_device_codes (user_code) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_expiry
  ON oauth_device_codes (expires_at) WHERE status = 'pending';

ALTER TABLE oauth_device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_device_codes FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'oauth_device_codes'
       AND policyname = 'device_codes_tenant_isolation'
  ) THEN
    CREATE POLICY device_codes_tenant_isolation
      ON oauth_device_codes
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- oauth_agent_tokens — per-agent access tokens (SHA-256 hashed at rest)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS oauth_agent_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text        NOT NULL UNIQUE,
  client_id     text        NOT NULL,
  client_label  text,
  tenant_id     text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       text        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  scopes        text[]      NOT NULL DEFAULT '{}',
  issued_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_oauth_agent_tokens_tenant_active
  ON oauth_agent_tokens (tenant_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_agent_tokens_user_active
  ON oauth_agent_tokens (user_id) WHERE revoked_at IS NULL;

ALTER TABLE oauth_agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_agent_tokens FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'oauth_agent_tokens'
       AND policyname = 'agent_tokens_tenant_isolation'
  ) THEN
    CREATE POLICY agent_tokens_tenant_isolation
      ON oauth_agent_tokens
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
