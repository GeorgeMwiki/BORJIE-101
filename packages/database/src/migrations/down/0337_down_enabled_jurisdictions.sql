-- =============================================================================
-- DOWN 0337 — drop the launch-market spine. Idempotent.
-- =============================================================================
BEGIN;
DROP TABLE IF EXISTS compliance_doc_uploads;
DROP TABLE IF EXISTS region_overlays;
DROP TABLE IF EXISTS enabled_countries;
COMMIT;
