-- =============================================================================
-- DOWN 0334 — revert the FORCE bit on the 57 tables 0334 swept, returning them
-- to ENABLE-only RLS (their tenant_isolation policies are left intact — they
-- were never touched by 0334). Idempotent: NO FORCE is inherently idempotent;
-- each table is guarded by to_regclass(...). DEV/STAGING ONLY — never run in
-- production, this re-opens the table-owner RLS-bypass gap that 0334 closed.
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
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
