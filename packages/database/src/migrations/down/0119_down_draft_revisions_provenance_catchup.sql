-- Down migration for 0119_draft_revisions_provenance_catchup.sql
-- Removes the provenance column + GIN index from draft_revisions.
-- Dev/staging only — production rows would lose their `via` lineage.

BEGIN;

DROP INDEX IF EXISTS draft_revisions_provenance_gin;
ALTER TABLE draft_revisions DROP COLUMN IF EXISTS provenance;

COMMIT;
