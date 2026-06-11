-- =============================================================================
-- Down-migration 0340 — reverse owner_governance_preferences.
--
-- Dev/staging only. Dropping this table removes the per-tenant governance
-- set-points the living-MD organ reads each tick. The fail-safe consequence is
-- benign: the governance store resolves to its safe in-code defaults (autonomy
-- cap 'delegate', someday cadence 7d, evidence enforced) when no row / no table
-- is present — exactly the same path as an absent row. NO money/licence/ledger
-- records live here. The MD simply governs at the platform defaults until
-- re-applied.
--
-- Reverses migration 0340_owner_governance_preferences.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS owner_governance_preferences_tenant_isolation    ON owner_governance_preferences;
DROP POLICY IF EXISTS owner_governance_preferences_service_role_bypass ON owner_governance_preferences;

DROP TABLE IF EXISTS owner_governance_preferences;

COMMIT;
