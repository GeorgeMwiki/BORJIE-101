-- =============================================================================
-- DOWN Migration 0111 - Share Links (Wave SUPERPOWERS)
--
-- Reverses 0111_share_links.sql:
--   - DROP POLICY share_links_tenant_isolation
--   - DROP TABLE share_links CASCADE
--
-- Data loss: TRUE (every generated share link is destroyed).
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS share_links_tenant_isolation ON share_links;
DROP TABLE IF EXISTS share_links CASCADE;

COMMIT;
