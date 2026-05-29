-- Down migration for 0120_mcp_sessions.sql
-- Drops mcp_sessions table, indexes, policy.
-- DATA LOSS — every persisted agent session is removed.
-- Dev / staging only.

BEGIN;

DROP POLICY IF EXISTS mcp_sessions_token_isolation ON mcp_sessions;
DROP INDEX IF EXISTS idx_mcp_sessions_token_last_activity;
DROP INDEX IF EXISTS idx_mcp_sessions_expiry;
DROP TABLE IF EXISTS mcp_sessions;

COMMIT;
