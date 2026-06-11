-- =============================================================================
-- Migration 0334 — FORCE-RLS sweep for the 57 ENABLE-only tenant-scoped tables.
--
-- WHY THIS MIGRATION EXISTS (CLAUDE.md hard rule)
-- ----------------------------------------------
-- These 57 tables already have RLS ENABLEd + a tenant_isolation policy (mostly
-- from the early dynamic ENABLE-loops in drizzle/0005 that predate the FORCE
-- convention), but they are MISSING the FORCE bit — so the table-OWNER role
-- bypasses RLS. That violates "RLS is FORCE-enabled on every tenant-scoped
-- table". The static RLS-coverage guard
-- (packages/database/src/__tests__/rls-coverage.test.ts) enumerated them in
-- RLS_ENABLE_ONLY_KNOWN_DEBT; this migration drives that registry to EMPTY.
--
-- This is a PURELY MECHANICAL FORCE sweep — NO policy is created or changed,
-- because each table already carries its own tenant_isolation policy. Adding
-- FORCE only closes the table-owner-bypass gap; it cannot change which rows a
-- non-owner role sees (their existing policy already governs that).
--
-- IDEMPOTENCY (CLAUDE.md hard rule)
-- --------------------------------
-- `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is idempotent by nature; on an
-- already-FORCEd table it is a pure no-op. Each table is guarded by a
-- to_regclass(...) existence check so a fresh DB that has not yet created a
-- given table (lex-order apply) never errors — the ALTER is simply skipped and
-- will be applied once the table exists (every one of these tables is created
-- earlier in the chain, so on a full apply none are skipped). No data is
-- touched, no backfill hazard.
--
-- Companion files:
--   * packages/database/src/__tests__/rls-coverage.test.ts (registry → empty)
--   * packages/database/src/migrations/down/0334_down_rls_residual_force_sweep.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  enable_only_tables text[] := ARRAY[
    'asset_status_snapshots', 'audit_log', 'bid_negotiations',
    'buyer_kyc_records', 'buyer_risk_reports', 'campaign_assets',
    'campaign_runs', 'clarifying_question_history', 'cognitive_turns',
    'compliance_escalations', 'compliance_verdicts', 'contract_remediation',
    'daily_research_cache', 'data_onboarding_row_provenance', 'data_onboarding_sessions',
    'decision_log', 'doc_evolution_proposals', 'doc_feedback_events',
    'document_artifacts', 'forecast_snapshots', 'fx_snapshots',
    'generated_reports', 'geology_scores', 'grievance_records',
    'hr_summaries', 'ingested_attachments', 'junior_csr_plans',
    'junior_drill_holes', 'junior_maintenance_events', 'junior_marketplace_listings',
    'licence_dormancy_scores', 'marketing_ab_results', 'marketing_compliance_scans',
    'marketing_telemetry_events', 'master_brain_briefings', 'metallurgy_recommendations',
    'notifications_outbox', 'ore_grade_snapshots', 'ore_stockpiles',
    'org_units', 'passive_capture_events', 'procurement_recommendations',
    'qaqc_results', 'risk_snapshots', 'safety_snapshots',
    'sales_advice', 'sample_batches', 'shift_reconciliations',
    'sic_events', 'site_layouts', 'spawn_proposals',
    'terminology_overrides', 'ui_evolution_proposals', 'ui_telemetry_events',
    'unit_economics_snapshots', 'user_scope_bindings', 'weekly_plans'
  ];
BEGIN
  FOREACH tbl IN ARRAY enable_only_tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
