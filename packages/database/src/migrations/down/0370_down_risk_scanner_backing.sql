-- =============================================================================
-- Down-migration 0370 — drop the risk-scanner backing relations.
--
-- Dev/staging only — DATA LOSS. Drops every relation created by
-- 0370_risk_scanner_backing.sql (tables + indexes + RLS policies fall with the
-- tables; the production_mom_summary VIEW is dropped too). Only for a clean
-- apply→reverse test on a throwaway DB; never run against an environment with
-- real owner state — the risk scanner re-darks every slice these relations
-- back (each field degrades to null / its empty default).
--
-- Reverses migration 0370_risk_scanner_backing.sql. Does NOT touch the base
-- tables the scanner also reads (sales / costs / cash_balances / incidents /
-- grievances / licences / production_tonnage_events) — those are owned by
-- earlier migrations.
-- =============================================================================

BEGIN;

DROP VIEW  IF EXISTS production_mom_summary CASCADE;

DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS contract_renewal_workflows CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS tra_correspondence CASCADE;
DROP TABLE IF EXISTS withholding_tax_summary CASCADE;
DROP TABLE IF EXISTS cda_milestones CASCADE;
DROP TABLE IF EXISTS security_audit_events CASCADE;
DROP TABLE IF EXISTS supplier_quality_signals CASCADE;
DROP TABLE IF EXISTS buyer_credit_signals CASCADE;
DROP TABLE IF EXISTS regulator_status CASCADE;
DROP TABLE IF EXISTS royalty_drafts_with_trend CASCADE;
DROP TABLE IF EXISTS workforce_separations CASCADE;
DROP TABLE IF EXISTS equipment_failures CASCADE;
DROP TABLE IF EXISTS fuel_inventory CASCADE;
DROP TABLE IF EXISTS payroll_schedule CASCADE;
DROP TABLE IF EXISTS accounts_receivable CASCADE;

COMMIT;
