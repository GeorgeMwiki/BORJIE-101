-- =============================================================================
-- 0127: AI audit chain — append-only enforcement at the engine level.
--
-- K5 security-DNA parity uplift. The HMAC chain in
-- `packages/ai-copilot/src/security/audit-hash-chain.ts` (rewritten in commit
-- 9faf3b9) is only tamper-EVIDENT — an attacker with DB write access can still
-- physically UPDATE or DELETE rows. This migration installs a per-row trigger
-- that REFUSES any UPDATE or DELETE on `ai_audit_chain`, so even a successful
-- privilege escalation cannot rewrite history without leaving a `pg_log` trail.
--
-- The trigger is defined SECURITY DEFINER with a SET search_path = pg_catalog
-- so it cannot be subverted by a malicious caller-supplied schema in the
-- session search path. INSERT is left untouched — append remains the ONLY
-- mutation path. TRUNCATE is blocked separately via the truncate trigger.
--
-- The migration is idempotent: it DROPs the trigger before recreating it so
-- re-running on an already-patched database is a no-op.
-- =============================================================================

CREATE OR REPLACE FUNCTION ai_audit_chain_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'ai_audit_chain is append-only: % operations are not permitted (row id=%, tenant_id=%, sequence_id=%)',
    TG_OP,
    COALESCE(OLD.id, ''),
    COALESCE(OLD.tenant_id, ''),
    COALESCE(OLD.sequence_id, 0)
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION ai_audit_chain_block_mutation() IS
  'K5 parity — append-only enforcement. Refuses UPDATE/DELETE on ai_audit_chain at the engine level. SECURITY DEFINER + fixed search_path so it cannot be bypassed via a malicious session search path.';

DROP TRIGGER IF EXISTS ai_audit_chain_no_update ON ai_audit_chain;
CREATE TRIGGER ai_audit_chain_no_update
  BEFORE UPDATE ON ai_audit_chain
  FOR EACH ROW
  EXECUTE FUNCTION ai_audit_chain_block_mutation();

DROP TRIGGER IF EXISTS ai_audit_chain_no_delete ON ai_audit_chain;
CREATE TRIGGER ai_audit_chain_no_delete
  BEFORE DELETE ON ai_audit_chain
  FOR EACH ROW
  EXECUTE FUNCTION ai_audit_chain_block_mutation();

-- TRUNCATE bypasses row-level triggers; the statement-level trigger covers it.
CREATE OR REPLACE FUNCTION ai_audit_chain_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'ai_audit_chain is append-only: TRUNCATE is not permitted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_audit_chain_no_truncate ON ai_audit_chain;
CREATE TRIGGER ai_audit_chain_no_truncate
  BEFORE TRUNCATE ON ai_audit_chain
  FOR EACH STATEMENT
  EXECUTE FUNCTION ai_audit_chain_block_truncate();

COMMENT ON TABLE ai_audit_chain IS
  'Append-only AI audit hash chain. UPDATE/DELETE/TRUNCATE refused at trigger level (migration 0127). Each row HMAC-chained to its predecessor via prev_hash → this_hash. See packages/ai-copilot/src/security/audit-hash-chain.ts.';
