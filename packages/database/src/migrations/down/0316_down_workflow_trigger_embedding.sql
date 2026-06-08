-- =============================================================================
-- Down-migration 0316 — reverse workflow_registry + trigger_embedding.
--
-- Dev/staging only. Dropping this table loses the persisted, embeddable flow
-- catalog the modality arbiter retrieves over. The fail-safe consequence is
-- benign: with no workflow_registry rows the arbiter's Tier-1 flow retrieval
-- returns empty, so a `workflow` modality is never selected by nearest-neighbour
-- — flows revert to explicit-id-only selection (the pre-0316 behaviour). No
-- money/licence/ledger records live here; rails are unaffected (they never
-- depended on this table).
--
-- Reverses migration 0316_workflow_trigger_embedding.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS workflow_registry_service_role_bypass ON workflow_registry;
DROP POLICY IF EXISTS workflow_registry_tenant_isolation ON workflow_registry;

DROP INDEX IF EXISTS idx_workflow_registry_trigger_embedding;
DROP INDEX IF EXISTS idx_workflow_registry_tenant_flow;
DROP INDEX IF EXISTS idx_workflow_registry_tenant_status;

DROP TABLE IF EXISTS workflow_registry;

COMMIT;
