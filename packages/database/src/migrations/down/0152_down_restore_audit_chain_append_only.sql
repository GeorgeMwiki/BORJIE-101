-- =============================================================================
-- DOWN 0152: revert ai_audit_chain restoration.
--
-- WARNING: DATA LOSS — CRITICAL. The ai_audit_chain is the HMAC-chained,
-- tamper-evident record of every AI turn. Dropping the table loses the
-- entire audit history and breaks the CLAUDE.md hard rule "AI audit chain
-- is hash-chained, append-only. No mutation." This down script exists
-- for dev / staging recovery only; NEVER run on prod without an
-- export-then-restore plan and explicit regulator sign-off.
--
-- Order matters: drop triggers first (they reference the function), then
-- the trigger functions, then the policy + RLS toggle, then indexes, then
-- the table itself. CASCADE on the table catches any FK survivors.
--
-- Reverses 0152_restore_audit_chain_append_only.sql:
--   - DROP append-only triggers (no_update, no_delete, no_truncate)
--   - DROP trigger functions (block_mutation, block_truncate)
--   - DROP tenant-isolation RLS policy
--   - DROP indexes (tenant_seq unique + idx, turn, created)
--   - DROP TABLE ai_audit_chain CASCADE
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS ai_audit_chain_no_truncate ON ai_audit_chain;
DROP TRIGGER IF EXISTS ai_audit_chain_no_delete   ON ai_audit_chain;
DROP TRIGGER IF EXISTS ai_audit_chain_no_update   ON ai_audit_chain;

DROP FUNCTION IF EXISTS ai_audit_chain_block_truncate();
DROP FUNCTION IF EXISTS ai_audit_chain_block_mutation();

DROP POLICY IF EXISTS ai_audit_chain_tenant_iso ON ai_audit_chain;

DROP INDEX IF EXISTS uq_ai_audit_chain_tenant_seq;
DROP INDEX IF EXISTS idx_ai_audit_chain_created;
DROP INDEX IF EXISTS idx_ai_audit_chain_turn;
DROP INDEX IF EXISTS idx_ai_audit_chain_tenant_seq;

DROP TABLE IF EXISTS ai_audit_chain CASCADE;

COMMIT;
