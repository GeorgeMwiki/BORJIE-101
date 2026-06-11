-- =============================================================================
-- Down-migration 0321 — reverse md_commitments.
--
-- Dev/staging only. Dropping this table removes the MD deferral / follow-through
-- commitment ledger (the prospective-memory backlog). The fail-safe consequence
-- is benign: the EstateMind RECONCILE sweep treats an absent table exactly like
-- an empty backlog (the reconcile port is FAIL-SAFE — a store fault never breaks
-- the tick) and falls back to the pre-deferral behaviour. NO money/licence/
-- ledger records live here; sovereign HITL rails never depended on this table
-- (they live in the policy-gate + mwikila_actions_inbox). The brain simply stops
-- holding a durable backlog until re-applied.
--
-- Reverses migration 0321_md_commitments.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS md_commitments_tenant_isolation   ON md_commitments;
DROP POLICY IF EXISTS md_commitments_service_role_bypass ON md_commitments;

DROP INDEX IF EXISTS md_commitments_due_idx;
DROP INDEX IF EXISTS md_commitments_open_idx;
DROP INDEX IF EXISTS md_commitments_deadline_idx;
DROP INDEX IF EXISTS md_commitments_event_idx;
DROP INDEX IF EXISTS md_commitments_idem_uniq;

DROP TABLE IF EXISTS md_commitments;

COMMIT;
