-- =============================================================================
-- Migration 0096b — Scope Node Links
--
-- Wave: SCOPE-SEGMENTATION (part B). Adds a nullable `scope_node_id`
-- column to the existing entity tables that the MD needs to roll up
-- across user-defined scopes. The column is nullable so legacy rows
-- without an explicit scope remain valid; new writes can opt-in.
--
-- Idempotent. Forward-only.
-- =============================================================================

BEGIN;

-- estate_entities — every entity can sit inside a scope node.
ALTER TABLE estate_entities
  ADD COLUMN IF NOT EXISTS scope_node_id uuid REFERENCES scope_nodes(id);

CREATE INDEX IF NOT EXISTS idx_estate_entities_scope_node
  ON estate_entities (tenant_id, scope_node_id);

-- external_parties — counterparties can be tied to a scope.
ALTER TABLE external_parties
  ADD COLUMN IF NOT EXISTS scope_node_id uuid REFERENCES scope_nodes(id);

CREATE INDEX IF NOT EXISTS idx_external_parties_scope_node
  ON external_parties (tenant_id, scope_node_id);

-- regulatory_filings — many filings are scope-specific.
ALTER TABLE regulatory_filings
  ADD COLUMN IF NOT EXISTS scope_node_id uuid REFERENCES scope_nodes(id);

CREATE INDEX IF NOT EXISTS idx_regulatory_filings_scope_node
  ON regulatory_filings (tenant_id, scope_node_id);

COMMIT;
