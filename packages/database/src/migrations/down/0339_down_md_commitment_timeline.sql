-- =============================================================================
-- Down-migration 0339 — reverse md_commitment_timeline.
--
-- Dev/staging only. Dropping this table removes the append-only lifecycle trail
-- of the MD commitment ledger (the living-MD organ audit spine). The fail-safe
-- consequence is benign: the living-plan surface's /past + /:id timeline reads
-- degrade to empty, and the timeline sink's writes become honest no-ops (the
-- sink is best-effort — a timeline fault never aborts the load-bearing
-- commitment transition). NO money/licence/ledger records live here; the
-- current commitment state survives in md_commitments. The brain simply stops
-- holding a durable history trail until re-applied.
--
-- Reverses migration 0339_md_commitment_timeline.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS md_commitment_timeline_tenant_isolation    ON md_commitment_timeline;
DROP POLICY IF EXISTS md_commitment_timeline_service_role_bypass ON md_commitment_timeline;

DROP INDEX IF EXISTS md_commitment_timeline_commitment_idx;
DROP INDEX IF EXISTS md_commitment_timeline_tenant_recent_idx;

DROP TABLE IF EXISTS md_commitment_timeline;

COMMIT;
