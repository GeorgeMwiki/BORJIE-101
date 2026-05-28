-- =============================================================================
-- DOWN Migration 0115 - Entity Index + Cross References (Wave ENTITY-LEGIBILITY)
--
-- Reverses 0115_entity_index.sql:
--   - DROP POLICY entity_cross_references_tenant_isolation
--   - DROP POLICY entity_index_tenant_isolation
--   - DROP TABLE entity_cross_references
--   - DROP TABLE entity_index
--   - DROP TYPE entity_cross_ref_relationship
--   - DROP TYPE entity_lifecycle_stage
--
-- The pgvector / pgcrypto extensions are NOT dropped (shared with the
-- rest of the schema). Order: cross-refs first because they reference
-- the same kind/id pair as entity_index.
--
-- Data loss: TRUE (every indexed entity + cross-reference destroyed).
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS entity_cross_references_tenant_isolation ON entity_cross_references;
DROP POLICY IF EXISTS entity_index_tenant_isolation ON entity_index;

DROP TABLE IF EXISTS entity_cross_references CASCADE;
DROP TABLE IF EXISTS entity_index CASCADE;

DROP TYPE IF EXISTS entity_cross_ref_relationship;
DROP TYPE IF EXISTS entity_lifecycle_stage;

COMMIT;
