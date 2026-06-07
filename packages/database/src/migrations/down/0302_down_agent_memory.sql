-- =============================================================================
-- Down-migration 0302 — reverse agent_memory.
--
-- Dev/staging only. Dropping this table loses every agent `/memories` note
-- (per-thread working scratchpad). The agent simply starts from an empty
-- notebook after a re-up; no business records are stored here. The '_platform'
-- sentinel tenant row is intentionally LEFT IN PLACE — other future
-- platform-scope tables may reference it, and removing it could orphan them.
--
-- Reverses migration 0302_agent_memory.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS agent_memory_tenant_isolation
  ON agent_memory;

DROP INDEX IF EXISTS idx_agent_memory_tenant_agent_key;
DROP INDEX IF EXISTS idx_agent_memory_tenant_agent;

DROP TABLE IF EXISTS agent_memory;

COMMIT;
