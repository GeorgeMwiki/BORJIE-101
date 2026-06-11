-- =============================================================================
-- Migration 0332 — worm_audit_log: append-only enforcement AT THE DB ENGINE.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- worm_audit_log is the WORM (write-once-read-many) tamper-evident chain for
-- every document that leaves @borjie/document-studio (per-tenant
-- previous_entry_hash -> chain_hash links; SOC 2 / GDPR Art. 30 export record).
-- Migration 0305 gave it FORCE RLS + a tenant-isolation policy, but RLS only
-- scopes WHO can touch a row — it does NOT stop an in-tenant UPDATE/DELETE from
-- rewriting history and silently breaking the hash chain. The schema header
-- promises "INSERT-only by convention (no update path)" — convention is not
-- enforcement. This migration makes WORM immutable at the engine, mirroring the
-- ai_audit_chain append-only trigger (migration 0152) so the same hard-rule
-- guarantee ("hash-chained, append-only. No mutation.") holds for this chain
-- too.
--
-- The trigger is SECURITY DEFINER with SET search_path = pg_catalog so it
-- cannot be subverted via a malicious session search path. INSERT is left
-- untouched — append remains the ONLY mutation path. TRUNCATE bypasses
-- row-level triggers in Postgres, so a separate statement-level trigger blocks
-- it.
--
-- IDEMPOTENCY (CLAUDE.md hard rule): CREATE OR REPLACE FUNCTION + DROP TRIGGER
-- IF EXISTS before each CREATE TRIGGER make re-runs a pure no-op. No data
-- touched, no backfill hazard.
--
-- Companion files:
--   * packages/database/src/schemas/worm-audit-log.schema.ts
--   * packages/database/src/migrations/0305_create_missing_schema_tables.sql (table + RLS)
--   * packages/database/src/migrations/down/0332_down_worm_audit_log_append_only.sql
-- =============================================================================

BEGIN;

-- ─── Append-only enforcement (parity with ai_audit_chain / migration 0152) ───
CREATE OR REPLACE FUNCTION worm_audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'worm_audit_log is append-only: % operations are not permitted (entry_id=%, tenant_id=%, sequence_number=%)',
    TG_OP,
    COALESCE(OLD.entry_id, ''),
    COALESCE(OLD.tenant_id, ''),
    COALESCE(OLD.sequence_number, 0)
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION worm_audit_log_block_mutation() IS
  'Borjie hard-rule enforcement (CLAUDE.md). Refuses UPDATE/DELETE on worm_audit_log at the engine level so the per-tenant WORM hash chain cannot be rewritten. SECURITY DEFINER + fixed search_path so it cannot be bypassed via a malicious session search path.';

DROP TRIGGER IF EXISTS worm_audit_log_no_update ON worm_audit_log;
CREATE TRIGGER worm_audit_log_no_update
  BEFORE UPDATE ON worm_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION worm_audit_log_block_mutation();

DROP TRIGGER IF EXISTS worm_audit_log_no_delete ON worm_audit_log;
CREATE TRIGGER worm_audit_log_no_delete
  BEFORE DELETE ON worm_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION worm_audit_log_block_mutation();

-- TRUNCATE bypasses row-level triggers; statement-level trigger covers it.
CREATE OR REPLACE FUNCTION worm_audit_log_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'worm_audit_log is append-only: TRUNCATE is not permitted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS worm_audit_log_no_truncate ON worm_audit_log;
CREATE TRIGGER worm_audit_log_no_truncate
  BEFORE TRUNCATE ON worm_audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION worm_audit_log_block_truncate();

COMMENT ON TABLE worm_audit_log IS
  'Append-only WORM document-export audit chain. UPDATE/DELETE/TRUNCATE refused at trigger level (migration 0332); FORCE RLS tenant isolation from migration 0305. Per-tenant previous_entry_hash -> chain_hash links — any post-hoc mutation breaks the chain. See packages/document-studio/src/signing/worm-audit.ts.';

COMMIT;
