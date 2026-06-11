-- =============================================================================
-- Down-migration 0343 — reverse oauth_state_nonces.
--
-- Dev/staging only. Dropping this table removes the DURABLE cluster-wide
-- single-use consumption of connector-OAuth state nonces. The fail-safe
-- consequence: the api-gateway callback's durable consume faults and the
-- callback REJECTS (fail-closed — it never silently falls back to the
-- in-process-only guard), so connector OAuth connects stop completing until
-- the table is restored. NO money/licence/ledger records live here; rows are
-- opaque random nonces (no PII, no token material). DATA LOSS: discards the
-- consumed-nonce ledger, re-opening the replay window for any still-unexpired
-- (< 10 min old) captured state. Dev/staging rollback only.
--
-- Reverses migration 0343_oauth_state_nonces.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS oauth_state_nonces_tenant_isolation    ON oauth_state_nonces;
DROP POLICY IF EXISTS oauth_state_nonces_service_role_bypass ON oauth_state_nonces;

DROP INDEX IF EXISTS oauth_state_nonces_created_idx;

DROP TABLE IF EXISTS oauth_state_nonces;

COMMIT;
