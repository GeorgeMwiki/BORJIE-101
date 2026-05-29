-- Down migration for 0118_oauth_agent_tokens.sql
-- Drops oauth_agent_tokens + oauth_device_codes tables, policies, indexes.
-- DATA LOSS — every issued agent token + pending device grant is removed.
-- Dev / staging only.

BEGIN;

-- Drop policies first (safe if absent)
DROP POLICY IF EXISTS agent_tokens_tenant_isolation  ON oauth_agent_tokens;
DROP POLICY IF EXISTS device_codes_tenant_isolation  ON oauth_device_codes;

-- Drop indexes
DROP INDEX IF EXISTS idx_oauth_agent_tokens_tenant_active;
DROP INDEX IF EXISTS idx_oauth_agent_tokens_user_active;
DROP INDEX IF EXISTS idx_oauth_device_codes_user_code_pending;
DROP INDEX IF EXISTS idx_oauth_device_codes_expiry;

-- Drop tables
DROP TABLE IF EXISTS oauth_agent_tokens;
DROP TABLE IF EXISTS oauth_device_codes;

COMMIT;
