-- =============================================================================
-- 0152: Restore AI audit chain — table + engine-level append-only enforcement.
--
-- Restores a guarantee dropped during the BossNyumba → Borjie hard-fork.
-- BN had `ai_audit_chain` (BN migration 0037) and the append-only trigger
-- (BN migration 0127). Borjie inherited the app-level HMAC code at
-- `packages/ai-copilot/src/security/audit-hash-chain.ts` but neither the
-- table nor the trigger came across — BN's 0127 was archived to
-- `.archive/migrations/` and Borjie's 0127 slot was reassigned to
-- `request_for_bids` instead. This migration closes the gap so the
-- CLAUDE.md hard rule "AI audit chain is hash-chained, append-only.
-- No mutation." is enforced at the database engine, not just in app code.
--
-- The trigger is defined SECURITY DEFINER with SET search_path = pg_catalog
-- so it cannot be subverted via a malicious session search path. INSERT is
-- left untouched — append remains the ONLY mutation path. TRUNCATE is
-- blocked via a separate statement-level trigger (TRUNCATE bypasses
-- row-level triggers in Postgres).
--
-- RLS is FORCE-enabled per Borjie's tenant-isolation invariant. The
-- migration is idempotent: CREATE TABLE IF NOT EXISTS, DROP TRIGGER IF
-- EXISTS before CREATE, and DO-block-guarded policy creation make re-runs
-- a no-op.
-- =============================================================================

BEGIN;

-- ─── ai_audit_chain table (BN 0037 parity) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_audit_chain (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id     BIGINT NOT NULL,
  turn_id         TEXT NOT NULL,
  session_id      TEXT,
  action          TEXT NOT NULL,
  prev_hash       TEXT NOT NULL,
  this_hash       TEXT NOT NULL,
  payload_ref     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_tenant_seq
  ON ai_audit_chain(tenant_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_turn
  ON ai_audit_chain(turn_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_created
  ON ai_audit_chain(created_at DESC);

-- Sequence must be unique per tenant so chain verification is deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_audit_chain_tenant_seq
  ON ai_audit_chain(tenant_id, sequence_id);

-- ─── RLS-FORCE (Borjie hard rule — every tenant-scoped table) ────────────────
ALTER TABLE ai_audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_chain FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = current_schema
       AND tablename  = 'ai_audit_chain'
       AND policyname = 'ai_audit_chain_tenant_iso'
  ) THEN
    CREATE POLICY ai_audit_chain_tenant_iso ON ai_audit_chain
      USING      (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Append-only enforcement (BN 0127 parity) ────────────────────────────────
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
  'Borjie hard-rule enforcement (CLAUDE.md). Refuses UPDATE/DELETE on ai_audit_chain at the engine level. SECURITY DEFINER + fixed search_path so it cannot be bypassed via a malicious session search path.';

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

-- TRUNCATE bypasses row-level triggers; statement-level trigger covers it.
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
  'Append-only AI audit hash chain. UPDATE/DELETE/TRUNCATE refused at trigger level (migration 0152). Each row HMAC-chained to its predecessor via prev_hash -> this_hash. See packages/ai-copilot/src/security/audit-hash-chain.ts. CLAUDE.md hard rule: "AI audit chain is hash-chained, append-only. No mutation."';

COMMIT;
