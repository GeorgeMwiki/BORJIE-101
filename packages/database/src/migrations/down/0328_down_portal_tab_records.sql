-- =============================================================================
-- Down-migration 0328 — reverse portal_tab_records.
--
-- Dev/staging only. Dropping this table removes the generic record store for
-- generated tabs. The fail-safe consequence is benign: with no table the
-- portal-genui record store's saveRecord/listRecords paths surface a clean DB
-- error the router maps to a 5xx, and generated tabs revert to render-only
-- (their documents in portal_tabs are untouched). NO money/licence/ledger
-- records live here — LedgerService.post() owns the immutable double-entry
-- ledger and never depended on this table. DATA LOSS: discards every record
-- submitted into a generated tab.
--
-- Reverses migration 0328_portal_tab_records.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS tenant_isolation_portal_tab_records           ON portal_tab_records;
DROP POLICY IF EXISTS portal_tab_records_service_role_bypass        ON portal_tab_records;

DROP INDEX IF EXISTS portal_tab_records_tenant_tab_idx;

DROP TABLE IF EXISTS portal_tab_records;

COMMIT;
