-- =============================================================================
-- DOWN Migration 0113 - Pinned Items (Wave SUPERPOWERS)
--
-- Reverses 0113_pinned_items.sql:
--   - DROP POLICY pinned_items_tenant_isolation
--   - DROP TABLE pinned_items CASCADE
--
-- Data loss: TRUE (every pinned item is destroyed).
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS pinned_items_tenant_isolation ON pinned_items;
DROP TABLE IF EXISTS pinned_items CASCADE;

COMMIT;
