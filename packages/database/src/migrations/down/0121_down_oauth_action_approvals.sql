-- Down migration for 0121_oauth_action_approvals.sql
-- Drops oauth_action_approvals table, indexes, policy.
-- DATA LOSS — every pending / consumed approval row is removed.
-- Dev / staging only.

BEGIN;

DROP POLICY IF EXISTS oauth_action_approvals_token_isolation ON oauth_action_approvals;
DROP INDEX IF EXISTS idx_oauth_action_approvals_token_pending;
DROP INDEX IF EXISTS idx_oauth_action_approvals_expiry;
DROP INDEX IF EXISTS idx_oauth_action_approvals_tool_status;
DROP TABLE IF EXISTS oauth_action_approvals;

COMMIT;
