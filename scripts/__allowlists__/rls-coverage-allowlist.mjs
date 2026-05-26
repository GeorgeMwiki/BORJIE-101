/**
 * RLS-coverage allow-list.
 *
 * Drizzle pgTable declarations whose schema carries `tenant_id` (or an
 * equivalent tenant-scoping column) but are intentionally exempt from
 * the `ENABLE ROW LEVEL SECURITY` + tenant policy requirement.
 *
 * Most entries below are TRACKED GAPS: pre-existing tenant tables that
 * landed before the Phase-D11 RLS sweep (migrations 0155 +
 * 0156_supabase_rls_phase2.sql, which together cover 40 tables). Each
 * tracked gap is a pending RLS-migration task (#33);
 * remove the entry once the migration lands so the scanner ratchets
 * forward.
 *
 * Architectural exemptions (NON-tracked-gap categories):
 *   1. Platform-global registries (jurisdictions, countries, currencies).
 *   2. Service-role-only tables (cross-tenant audit aggregates).
 *   3. Tables where `tenant_id` is a scope-hint not an authz boundary.
 *   4. Append-only ledgers where service_role exclusivity is enforced
 *      at the application layer.
 *
 * Keys are the SQL table name (snake_case). Reasons must be ≥ 8 chars
 * and explain the architectural choice or tracked-gap origin.
 */

export const RLS_ALLOWLIST = new Map([
  // ─── TRACKED GAPS: pre-Phase-D11 tenant tables without RLS migrations.
  // Pulled from the 2026-05-18 scanner pass. Each entry should be removed
  // when a matching RLS migration lands.
  ['access_handover_records', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['ai_cost_entries', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  // ai_decision_feedback — RLS landed in migration 0166. Removed from allowlist.
  // ai_proactive_alerts  — RLS landed in migration 0166. Removed from allowlist.
  ['ai_semantic_memories', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['approval_policies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['approval_policy_actions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['arrears_case_projections', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['arrears_cases', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['arrears_line_proposals', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['autonomous_action_audit', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['autonomy_policies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['availability_slots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['bids', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['bkt_mastery', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['bottlenecks', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['classroom_participants', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['classroom_quiz_responses', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['classroom_quizzes', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['classroom_sessions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['communication_consents', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['complaint_records', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['consolidation_emissions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['core_memory_blocks', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['credit_rating_promises', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['credit_rating_sharing_opt_ins', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['credit_rating_snapshots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['credit_rating_weights', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['delivery_receipts', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  // disbursements — RLS landed in migration 0166. Removed from allowlist.
  ['document_access_logs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['document_render_jobs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['escalation_chain_runs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['exception_inbox', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['executive_briefings', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['feedback_submissions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['field_encryption_audit', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  // gdpr_deletion_requests — RLS landed in migration 0166. Removed from allowlist.
  ['geo_assignments', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['geo_label_types', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['geo_nodes', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['gepg_control_numbers', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['gepg_reconciliation_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['implicit_feedback_signals', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['improvement_snapshots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['interactive_report_action_acks', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['interactive_report_versions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['invite_codes', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['iot_anomalies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['iot_observations', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['iot_sensors', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['kernel_action_audit', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['kernel_feedback', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['kernel_goals', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['kernel_persona_drift_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['kernel_provenance', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['legal_cases', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['letter_requests', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['maintenance_problem_categories', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['maintenance_problems', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['market_rate_snapshots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['marketplace_listings', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['mdr_plan_items', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['message_instances', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['message_templates', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['migration_runs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['monthly_close_run_steps', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['monthly_close_runs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['negotiation_policies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['negotiation_turns', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['negotiations', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['notices', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['notification_dispatch_log', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['occupancies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['org_memberships', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['owner_statements', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  // payment_intents — RLS landed in migration 0166. Removed from allowlist.
  ['payment_plan_agreements', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['payment_plans', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['persona_branding', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['persona_registry', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['predictive_intervention_opportunities', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['privacy_budget_ledger', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['privacy_budget_spend', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['procedure_completion_logs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['process_observations', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['progressive_context_snapshots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['property_grade_snapshots', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['property_valuations', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['receipts', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['reward_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['reward_policies', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['risk_scores', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['scan_bundle_pages', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['scan_bundles', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['semantic_cache_log', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['sensorium_event_log', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['session_replay_chunks', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['skill_registry', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  // sovereign_approvals — RLS landed in migration 0166. Removed from allowlist.
  ['statements', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['station_master_coverage', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['sub_md_slo_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['sub_md_slos', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['task_sensor_routing', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['temporal_communities', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['temporal_entities', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['temporal_relationships', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_ai_budgets', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_autonomy_caps', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_budget_envelopes', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_feature_flag_overrides', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_gamification_profile', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_grading_weights', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_predictions', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenant_risk_reports', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['tenders', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['training_assignments', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['training_delivery_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['training_paths', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['unit_waitlists', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['vacancy_pipeline_runs', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['waitlist_outreach_events', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['warehouse_items', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['warehouse_movements', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
  ['worker_tags', 'TRACKED GAP — tenant table without RLS migration; pre-Phase-D11 schema.'],
]);
