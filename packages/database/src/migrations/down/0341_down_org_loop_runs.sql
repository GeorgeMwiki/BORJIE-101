-- =============================================================================
-- Down-migration 0341 — reverse org_loop_runs.
--
-- Dev/staging only. Dropping this table removes the self-running-org SPINE
-- correlation identity (the durable join between an md_commitment and the
-- mining_task it spawned, plus each loop run's stage/status). The fail-safe
-- consequence: with no table the loop-economy dispatcher / close-the-loop edge
-- degrade to honest no-ops (a loop run cannot be created, so no task is
-- dispatched and no commitment is auto-closed) — the originating commitment
-- survives in md_commitments and is re-read by the reconcile sweep. NO
-- money/licence/ledger records live here. DATA LOSS: discards the loop-run
-- history + the in-flight stage of any open run. Dev/staging rollback only.
--
-- Reverses migration 0341_org_loop_runs.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS org_loop_runs_tenant_isolation    ON org_loop_runs;
DROP POLICY IF EXISTS org_loop_runs_service_role_bypass ON org_loop_runs;

DROP TABLE IF EXISTS org_loop_runs;

COMMIT;
