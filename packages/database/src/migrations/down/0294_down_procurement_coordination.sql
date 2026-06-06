-- =============================================================================
-- Down-migration 0294 — reverse procurement_coordination.
--
-- Dev/staging only. Dropping these tables loses the entire procurement record:
-- vendors + KYC docs, budgets, requisitions, approval chains/policies, purchase
-- orders, PO-number sequences, and vendor invoices. A production rollback must
-- export every table first if any procurement history is retained for audit /
-- financial-control purposes.
--
-- Drop order: child tables first (FK → procurement_vendors), then vendors, then
-- the standalone tables. Policies + indexes drop with the tables.
--
-- Reverses migration 0294_procurement_coordination.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS procurement_kyc_documents;
DROP TABLE IF EXISTS procurement_vendor_invoices;
DROP TABLE IF EXISTS procurement_purchase_orders;
DROP TABLE IF EXISTS procurement_po_sequences;
DROP TABLE IF EXISTS procurement_approval_chains;
DROP TABLE IF EXISTS procurement_approval_policies;
DROP TABLE IF EXISTS procurement_requisitions;
DROP TABLE IF EXISTS procurement_budgets;
DROP TABLE IF EXISTS procurement_vendors;

COMMIT;
