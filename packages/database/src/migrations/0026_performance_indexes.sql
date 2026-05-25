-- =============================================================================
-- 0026: Performance indexes — Wave 1-3 amendments
-- =============================================================================
-- Purely additive. Every statement uses CREATE INDEX IF NOT EXISTS so it is
-- idempotent and safe to re-run. No existing indexes are removed.
--
-- Conventions:
--   * Composite indexes put (tenant_id, …) first to align with RLS + tenant
--     isolation — this is the most common filter column.
--   * Partial indexes narrow the working set for hot predicates
--     (status='active', status='open', …).
--   * GIN indexes cover jsonb columns that are filtered via @> / ? / jsonb_path_ops.
--   * BRIN indexes target monotonically-increasing created_at / occurred_at
--     columns on append-heavy tables (cheap storage, great range scans once
--     tables exceed ~1M rows).
--
-- Spec ref: Docs/PERFORMANCE.md
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Approval policies
--   Supports: list-by-tenant query in postgres-approval-policy-repository.ts
--             (the composite PK already covers lookup-by-(tenant,type)).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS approval_policies_tenant_type_idx
  ON approval_policies (tenant_id, type);

CREATE INDEX IF NOT EXISTS approval_policies_policy_json_gin_idx
  ON approval_policies USING GIN (policy_json);

-- ----------------------------------------------------------------------------
-- 2. GePG — control numbers + reconciliation
--   Supports: dashboard filters by (tenant, status) and (tenant, expires_at).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS gepg_cn_tenant_status_idx
  ON gepg_control_numbers (tenant_id, status);

CREATE INDEX IF NOT EXISTS gepg_cn_tenant_expires_idx
  ON gepg_control_numbers (tenant_id, expires_at)
  WHERE status IN ('pending', 'issued');

CREATE INDEX IF NOT EXISTS gepg_cn_tenant_created_brin_idx
  ON gepg_control_numbers USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS gepg_cn_raw_response_gin_idx
  ON gepg_control_numbers USING GIN (raw_provider_response);

CREATE INDEX IF NOT EXISTS gepg_recon_tenant_occurred_idx
  ON gepg_reconciliation_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS gepg_recon_cn_idx
  ON gepg_reconciliation_events (control_number_id);

CREATE INDEX IF NOT EXISTS gepg_recon_payment_idx
  ON gepg_reconciliation_events (payment_id);

CREATE INDEX IF NOT EXISTS gepg_recon_payload_gin_idx
  ON gepg_reconciliation_events USING GIN (payload);

CREATE INDEX IF NOT EXISTS gepg_recon_occurred_brin_idx
  ON gepg_reconciliation_events USING BRIN (occurred_at);

-- ----------------------------------------------------------------------------
-- 3. Arrears ledger
--   Supports: pending-approvals queue, per-case projections, per-customer feed.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS arrears_prop_tenant_status_idx
  ON arrears_line_proposals (tenant_id, status);

CREATE INDEX IF NOT EXISTS arrears_prop_tenant_customer_idx
  ON arrears_line_proposals (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS arrears_prop_pending_idx
  ON arrears_line_proposals (tenant_id, proposed_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS arrears_prop_evidence_gin_idx
  ON arrears_line_proposals USING GIN (evidence_doc_ids);

CREATE INDEX IF NOT EXISTS arrears_prop_proposed_brin_idx
  ON arrears_line_proposals USING BRIN (proposed_at);

CREATE INDEX IF NOT EXISTS arrears_proj_tenant_case_idx
  ON arrears_case_projections (tenant_id, arrears_case_id, as_of DESC);

CREATE INDEX IF NOT EXISTS arrears_proj_tenant_customer_idx
  ON arrears_case_projections (tenant_id, customer_id, as_of DESC);

CREATE INDEX IF NOT EXISTS arrears_proj_lines_gin_idx
  ON arrears_case_projections USING GIN (lines);

-- arrears_cases assumed to exist from earlier migration; only add if table present.
-- (Wrapped in a DO block so the migration remains idempotent even if the table
-- has been renamed/deferred.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'arrears_cases') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS arrears_cases_tenant_status_idx
             ON arrears_cases (tenant_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS arrears_cases_tenant_customer_idx
             ON arrears_cases (tenant_id, customer_id)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Negotiation
--   Supports: open-negotiation lookups, per-listing/unit inbox, turn replay.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS negotiation_policies_active_domain_idx
  ON negotiation_policies (tenant_id, domain, active);

CREATE INDEX IF NOT EXISTS negotiation_policies_concessions_gin_idx
  ON negotiation_policies USING GIN (acceptable_concessions);

CREATE INDEX IF NOT EXISTS negotiations_tenant_status_open_idx
  ON negotiations (tenant_id, last_activity_at DESC)
  WHERE status IN ('open', 'counter_sent');

CREATE INDEX IF NOT EXISTS negotiations_listing_idx
  ON negotiations (listing_id)
  WHERE listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS negotiations_prospect_idx
  ON negotiations (prospect_customer_id)
  WHERE prospect_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS negotiations_policy_idx
  ON negotiations (policy_id);

CREATE INDEX IF NOT EXISTS negotiations_last_activity_brin_idx
  ON negotiations USING BRIN (last_activity_at);

CREATE INDEX IF NOT EXISTS negotiation_turns_tenant_created_brin_idx
  ON negotiation_turns USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS negotiation_turns_raw_payload_gin_idx
  ON negotiation_turns USING GIN (raw_payload);

-- ----------------------------------------------------------------------------
-- 5. Marketplace — listings, tenders, bids
--   Supports: public marketplace feeds (status='published'), tender inbox,
--             vendor bid history.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS marketplace_listings_published_idx
  ON marketplace_listings (tenant_id, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS marketplace_listings_kind_idx
  ON marketplace_listings (tenant_id, listing_kind, status);

CREATE INDEX IF NOT EXISTS marketplace_listings_property_idx
  ON marketplace_listings (property_id)
  WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_listings_attributes_gin_idx
  ON marketplace_listings USING GIN (attributes);

CREATE INDEX IF NOT EXISTS marketplace_listings_media_gin_idx
  ON marketplace_listings USING GIN (media);

CREATE INDEX IF NOT EXISTS tenders_open_closes_idx
  ON tenders (tenant_id, closes_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS tenders_invited_vendors_gin_idx
  ON tenders USING GIN (invited_vendor_ids);

CREATE INDEX IF NOT EXISTS bids_tender_price_idx
  ON bids (tender_id, price ASC);

CREATE INDEX IF NOT EXISTS bids_vendor_tenant_idx
  ON bids (tenant_id, vendor_id, submitted_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Waitlist
--   Supports: per-unit active-waitlist selection in priority order, customer
--             dashboard, outreach audit feeds.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS unit_waitlists_unit_active_idx
  ON unit_waitlists (tenant_id, unit_id, priority ASC, created_at ASC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS unit_waitlists_customer_active_idx
  ON unit_waitlists (tenant_id, customer_id, created_at ASC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS unit_waitlists_preferred_channels_gin_idx
  ON unit_waitlists USING GIN (preferred_channels);

CREATE INDEX IF NOT EXISTS waitlist_outreach_events_waitlist_occurred_idx
  ON waitlist_outreach_events (waitlist_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS waitlist_outreach_events_occurred_brin_idx
  ON waitlist_outreach_events USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS waitlist_outreach_events_payload_gin_idx
  ON waitlist_outreach_events USING GIN (message_payload);

-- ----------------------------------------------------------------------------
-- 7. Gamification
--   Supports: active-policy selection (where active=true), per-customer
--             profile lookup, event dedup, leaderboard-style tier queries.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS reward_policies_tenant_active_idx
  ON reward_policies (tenant_id, version DESC)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS gm_profile_tenant_customer_idx
  ON tenant_gamification_profile (tenant_id, customer_id, as_of DESC);

CREATE INDEX IF NOT EXISTS gm_profile_tenant_tier_idx
  ON tenant_gamification_profile (tenant_id, tier);

CREATE INDEX IF NOT EXISTS reward_event_tenant_customer_occurred_idx
  ON reward_events (tenant_id, customer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS reward_event_tenant_dedup_idx
  ON reward_events (tenant_id, dedup_key);

CREATE INDEX IF NOT EXISTS reward_event_occurred_brin_idx
  ON reward_events USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS reward_event_payload_gin_idx
  ON reward_events USING GIN (payload);

-- ----------------------------------------------------------------------------
-- 8. Conditional surveys
--   Supports: scheduled/overdue dashboards, per-survey findings + actions.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS conditional_surveys_tenant_status_idx
  ON conditional_surveys (tenant_id, status);

CREATE INDEX IF NOT EXISTS conditional_surveys_summary_gin_idx
  ON conditional_surveys USING GIN (summary);

CREATE INDEX IF NOT EXISTS conditional_survey_findings_survey_severity_idx
  ON conditional_survey_findings (survey_id, severity);

CREATE INDEX IF NOT EXISTS conditional_survey_findings_metadata_gin_idx
  ON conditional_survey_findings USING GIN (metadata);

CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_survey_status_idx
  ON conditional_survey_action_plans (survey_id, status);

CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_tenant_status_idx
  ON conditional_survey_action_plans (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 9. FAR asset components / assignments / condition checks
--   Supports: per-property inventory, due-check worker, outcome dashboards.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS asset_components_tenant_property_idx
  ON asset_components (tenant_id, property_id, status);

CREATE INDEX IF NOT EXISTS asset_components_metadata_gin_idx
  ON asset_components USING GIN (metadata);

CREATE INDEX IF NOT EXISTS far_assignments_tenant_component_idx
  ON far_assignments (tenant_id, component_id);

CREATE INDEX IF NOT EXISTS far_assignments_assigned_to_idx
  ON far_assignments (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS condition_check_events_component_performed_idx
  ON condition_check_events (component_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS condition_check_events_assignment_performed_idx
  ON condition_check_events (far_assignment_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS condition_check_events_due_brin_idx
  ON condition_check_events USING BRIN (due_at);

-- ----------------------------------------------------------------------------
-- 10. Station master coverage / worker tags
--   Supports: routing by (tenant, station_master) and tag lookup.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS station_master_coverage_tenant_sm_idx
  ON station_master_coverage (tenant_id, station_master_id);

CREATE INDEX IF NOT EXISTS station_master_coverage_value_gin_idx
  ON station_master_coverage USING GIN (coverage_value);

CREATE INDEX IF NOT EXISTS worker_tags_tenant_user_idx
  ON worker_tags (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS worker_tags_tenant_tag_idx
  ON worker_tags (tenant_id, tag);

CREATE INDEX IF NOT EXISTS worker_tags_metadata_gin_idx
  ON worker_tags USING GIN (metadata);

-- ----------------------------------------------------------------------------
-- 11. Interactive reports
--   Supports: latest-version lookup per report_instance_id.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS interactive_report_versions_tenant_instance_idx
  ON interactive_report_versions (tenant_id, report_instance_id, version DESC);

CREATE INDEX IF NOT EXISTS interactive_report_versions_media_gin_idx
  ON interactive_report_versions USING GIN (media_references);

CREATE INDEX IF NOT EXISTS interactive_report_versions_action_plans_gin_idx
  ON interactive_report_versions USING GIN (action_plans);

CREATE INDEX IF NOT EXISTS interactive_report_action_acks_version_plan_idx
  ON interactive_report_action_acks (interactive_report_version_id, action_plan_id);

-- ----------------------------------------------------------------------------
-- 12. Tenant financial statements + litigation history
--   Supports: per-customer intake review queue.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tenant_financial_statements_tenant_status_idx
  ON tenant_financial_statements (tenant_id, status);

CREATE INDEX IF NOT EXISTS tenant_financial_statements_tenant_customer_idx
  ON tenant_financial_statements (tenant_id, customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS tenant_financial_statements_sources_gin_idx
  ON tenant_financial_statements USING GIN (income_sources);

CREATE INDEX IF NOT EXISTS tenant_litigation_history_tenant_customer_idx
  ON tenant_litigation_history (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS tenant_litigation_history_outcome_idx
  ON tenant_litigation_history (tenant_id, outcome);

-- ----------------------------------------------------------------------------
-- 13. Intelligence history / risk reports
--   Supports: per-customer trend queries, latest-per-tenant scorecard.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS intelligence_history_tenant_customer_date_idx
  ON intelligence_history (tenant_id, customer_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS intelligence_history_date_brin_idx
  ON intelligence_history USING BRIN (snapshot_date);

CREATE INDEX IF NOT EXISTS intelligence_history_payment_subs_gin_idx
  ON intelligence_history USING GIN (payment_sub_scores);

CREATE INDEX IF NOT EXISTS intelligence_history_churn_subs_gin_idx
  ON intelligence_history USING GIN (churn_sub_scores);

CREATE INDEX IF NOT EXISTS tenant_risk_reports_tenant_customer_idx
  ON tenant_risk_reports (tenant_id, customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS tenant_risk_reports_tenant_status_idx
  ON tenant_risk_reports (tenant_id, status);

CREATE INDEX IF NOT EXISTS tenant_risk_reports_snapshot_gin_idx
  ON tenant_risk_reports USING GIN (snapshot);

-- ----------------------------------------------------------------------------
-- 14. Compliance export jobs
--   Supports: dashboards of pending/ready jobs, per-type periodic scheduling.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS compliance_exports_tenant_status_idx
  ON compliance_exports (tenant_id, status);

CREATE INDEX IF NOT EXISTS compliance_exports_tenant_type_period_idx
  ON compliance_exports (tenant_id, export_type, period_start DESC);

CREATE INDEX IF NOT EXISTS compliance_exports_regulator_context_gin_idx
  ON compliance_exports USING GIN (regulator_context);

CREATE INDEX IF NOT EXISTS compliance_exports_scheduled_brin_idx
  ON compliance_exports USING BRIN (scheduled_at);

-- ----------------------------------------------------------------------------
-- 15. Migration runs
--   Supports: dashboard filtering by (tenant, status) and recent-first listing.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS migration_runs_tenant_created_idx
  ON migration_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS migration_runs_extraction_summary_gin_idx
  ON migration_runs USING GIN (extraction_summary);

CREATE INDEX IF NOT EXISTS migration_runs_diff_summary_gin_idx
  ON migration_runs USING GIN (diff_summary);

CREATE INDEX IF NOT EXISTS migration_runs_committed_summary_gin_idx
  ON migration_runs USING GIN (committed_summary);

-- ----------------------------------------------------------------------------
-- 16. Document render jobs / letter requests / scan bundles (NEW 10/14)
--   Supports: per-tenant queue, status filter, template usage analytics.
-- ----------------------------------------------------------------------------
-- These tables are introduced by Drizzle schemas but may not have run
-- CREATE TABLE yet in some environments — wrap in table-exists guards.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_render_jobs') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_render_jobs_tenant_status_idx
             ON document_render_jobs (tenant_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_render_jobs_requested_brin_idx
             ON document_render_jobs USING BRIN (requested_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_render_jobs_queued_idx
             ON document_render_jobs (tenant_id, requested_at ASC)
             WHERE status = ''queued''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_render_jobs_input_gin_idx
             ON document_render_jobs USING GIN (input_payload)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'letter_requests') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS letter_requests_tenant_status_idx
             ON letter_requests (tenant_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS letter_requests_tenant_customer_idx
             ON letter_requests (tenant_id, customer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS letter_requests_pending_approval_idx
             ON letter_requests (tenant_id, requested_at ASC)
             WHERE status = ''pending_approval''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS letter_requests_payload_gin_idx
             ON letter_requests USING GIN (request_payload)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_bundles') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS scan_bundles_tenant_status_idx
             ON scan_bundles (tenant_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS scan_bundles_tenant_creator_idx
             ON scan_bundles (tenant_id, created_by, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS scan_bundles_processing_log_gin_idx
             ON scan_bundles USING GIN (processing_log)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_bundle_pages') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS scan_bundle_pages_bundle_page_idx
             ON scan_bundle_pages (bundle_id, page_number)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 17. Document embeddings / chat sessions / chat messages (NEW 15)
--   Supports: per-document retrieval context, session timeline, citation replay.
--   The pgvector index is at the bottom of this file (section 20).
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_embeddings') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_embeddings_tenant_document_idx
             ON document_embeddings (tenant_id, document_id, chunk_index)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_embeddings_chunk_meta_gin_idx
             ON document_embeddings USING GIN (chunk_meta)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'doc_chat_sessions') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_sessions_tenant_last_message_idx
             ON doc_chat_sessions (tenant_id, last_message_at DESC NULLS LAST)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_sessions_documents_gin_idx
             ON doc_chat_sessions USING GIN (document_ids)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_sessions_participants_gin_idx
             ON doc_chat_sessions USING GIN (participants)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'doc_chat_messages') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_messages_session_created_idx
             ON doc_chat_messages (session_id, created_at ASC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_messages_tenant_created_brin_idx
             ON doc_chat_messages USING BRIN (created_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS doc_chat_messages_citations_gin_idx
             ON doc_chat_messages USING GIN (citations)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 18. Damage deduction / sublease requests / tenant groups
--   Supports: list-by-lease, status-gated queues.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS damage_deduction_cases_tenant_status_idx
  ON damage_deduction_cases (tenant_id, status);

CREATE INDEX IF NOT EXISTS damage_deduction_cases_ai_turns_gin_idx
  ON damage_deduction_cases USING GIN (ai_mediator_turns);

CREATE INDEX IF NOT EXISTS sublease_requests_parent_status_idx
  ON sublease_requests (parent_lease_id, status);

CREATE INDEX IF NOT EXISTS sublease_requests_subtenant_idx
  ON sublease_requests (subtenant_candidate_id)
  WHERE subtenant_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_groups_members_gin_idx
  ON tenant_groups USING GIN (members);

-- ----------------------------------------------------------------------------
-- 19. Identity — tenant_identities / org_memberships / invite_codes
--   Supports: login by phone/email, redeem-by-code, membership lookups.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tenant_identities_profile_gin_idx
  ON tenant_identities USING GIN (profile);

CREATE INDEX IF NOT EXISTS tenant_identities_merged_into_idx
  ON tenant_identities (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_memberships_platform_user_idx
  ON org_memberships (platform_tenant_id, user_id);

CREATE INDEX IF NOT EXISTS org_memberships_active_idx
  ON org_memberships (platform_tenant_id, organization_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS invite_codes_active_idx
  ON invite_codes (organization_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS invite_codes_attachment_hints_gin_idx
  ON invite_codes USING GIN (attachment_hints);

-- ----------------------------------------------------------------------------
-- 20. pgvector indexes — document_embeddings.embedding
--   Requires the `vector` extension. We attempt CREATE EXTENSION; if it fails
--   (unprivileged user / managed Postgres without the extension whitelisted),
--   the pgvector indexes are skipped.
--
--   To enable manually on a managed Postgres (Supabase, RDS, Neon):
--     CREATE EXTENSION IF NOT EXISTS vector;
--
--   Then either run this migration again, or run manually:
--     CREATE INDEX IF NOT EXISTS document_embeddings_vector_hnsw_idx
--       ON document_embeddings
--       USING hnsw (embedding vector_cosine_ops)
--       WITH (m = 16, ef_construction = 64);
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  -- Only attempt if the extension + table are both present. We do not try to
  -- CREATE EXTENSION here because that requires elevated privileges that
  -- migration runners don't always have.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_embeddings') THEN
    -- HNSW is preferred on pgvector >= 0.5.0. If it fails, fall back to IVFFlat.
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS document_embeddings_vector_hnsw_idx
               ON document_embeddings
               USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)';
    EXCEPTION WHEN others THEN
      -- Fallback: IVFFlat with 100 lists (good default for ~100K-1M rows).
      EXECUTE 'CREATE INDEX IF NOT EXISTS document_embeddings_vector_ivfflat_idx
               ON document_embeddings
               USING ivfflat (embedding vector_cosine_ops)
               WITH (lists = 100)';
    END;
  END IF;
END $$;

-- End of 0026
