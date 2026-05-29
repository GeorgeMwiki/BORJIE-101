-- =============================================================================
-- Migration 0125 — Decision chain UNIQUE belt-and-braces
--
-- Closes audit gap G3 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`.
--
-- The `decisions` recorder (services/api-gateway/src/services/
-- decision-journal/recorder.ts) reads `lastDecisionHash(tenantId)`,
-- computes the new row's `entry_hash` chained off that `prev_hash`,
-- then INSERTs. Two concurrent writers in the same tenant can both
-- read the same `prev_hash` and both write rows that chain off the
-- same predecessor → fork in the hash chain.
--
-- Today the writer is serialised at the brain orchestrator layer (one
-- writer per tenant per turn). This migration adds a UNIQUE index on
-- `(tenant_id, prev_hash)` so a second concurrent writer hits a
-- 23505 unique_violation at the SQL layer — belt-and-braces. The
-- recorder catches the violation and retries once off the fresh
-- `lastDecisionHash`.
--
-- Notes:
--   - Partial index: `prev_hash IS NOT NULL` exempts the genesis row
--     (the first decision per tenant), which by definition has no
--     predecessor and therefore no prev_hash. Without the WHERE the
--     UNIQUE would refuse two tenants' genesis rows.
--   - Idempotent (IF NOT EXISTS). Forward-only. Append-only per
--     CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS decisions_tenant_prev_hash_unique
  ON decisions (tenant_id, prev_hash)
  WHERE prev_hash IS NOT NULL;

COMMENT ON INDEX decisions_tenant_prev_hash_unique IS
  'G3 robustness 2026-05-29: refuse hash-chain forks at the SQL layer. '
  'Partial (prev_hash IS NOT NULL) so per-tenant genesis rows can coexist. '
  'Companion to services/api-gateway/src/services/decision-journal/recorder.ts '
  'which catches the 23505 unique_violation and retries off the fresh head.';

COMMIT;
