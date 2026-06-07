-- =============================================================================
-- Down-migration 0301 — reverse mcp_cost_ledger.
--
-- Dev/staging only. Dropping this table loses every persisted MCP tool-call
-- cost row (per-tenant / per-server spend history). A production rollback must
-- export the table first if any spend records are retained for billing /
-- chargeback reconciliation.
--
-- Reverses migration 0301_mcp_cost_persistence.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS mcp_cost_ledger_tenant_isolation
  ON mcp_cost_ledger;

DROP INDEX IF EXISTS idx_mcp_cost_ledger_tenant_occurred;
DROP INDEX IF EXISTS idx_mcp_cost_ledger_tenant_tool_occurred;
DROP INDEX IF EXISTS idx_mcp_cost_ledger_tenant_server_occurred;

DROP TABLE IF EXISTS mcp_cost_ledger;

COMMIT;
