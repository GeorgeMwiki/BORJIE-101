-- 0157_rls_repoint_legacy_tenant_guc_intree.sql
--
-- Repoint EVERY in-tree RLS policy that still reads the legacy `app.tenant_id`
-- GUC onto the canonical `app.current_tenant_id` GUC that api-gateway's
-- `databaseMiddleware` actually binds
-- (services/api-gateway/src/middleware/database.ts -> set_config(
-- 'app.current_tenant_id', <tenant>, false)).
--
-- WHY (identical failure mode to 0150 + 0156):
--   The gateway only ever sets `app.current_tenant_id`. A FORCE-RLS policy
--   whose predicate reads `current_setting('app.tenant_id', true)` therefore
--   evaluates `NULL = tenant_id` -> NULL, which Postgres treats as FALSE under
--   RLS. Result: every authenticated read AND write against the affected table
--   silently returns / affects ZERO rows. The Supabase `service_role`
--   connection has BYPASSRLS, so out-of-band ops never noticed.
--
--   0150 fixed request_for_bids / request_for_bid_responses /
--   owner_delegation_prefs / mwikila_actions_inbox.
--   0156 fixed reminders / owner_tabs.
--   This migration (0157) closes the remaining in-tree literal-`CREATE POLICY`
--   tables that 0150/0156 did not cover. Every policy below is reproduced from
--   its original creating migration with the GUC name as the ONLY change; the
--   policy name, target table, `FOR ALL`, USING/WITH CHECK shape, and the
--   tenant_id cast (`::text` for UUID-typed columns, bare for TEXT-typed
--   columns) are preserved byte-for-byte from the source migration so replaying
--   the source followed by 0157 lands the correct end state.
--
-- SCOPE NOTE (deliberately bounded):
--   This migration ONLY repoints policies whose wrong-GUC `CREATE POLICY`
--   statement is *literally visible* in an in-tree migration under
--   packages/database/src/migrations/. It does NOT touch:
--     * `reminders` / `owner_tabs` (already fixed by 0156),
--     * the 0150 set (already fixed),
--     * the dynamically-generated (`EXECUTE format(...)`) policies in
--       packages/database/drizzle/0003..0076 — those are applied by a separate
--       runner (scripts/apply-borjie-mining-migration.mjs) and are tracked as
--       drift items DR-3 / DR-7 in
--       packages/database/MIGRATION_RECONCILIATION.md,
--     * any policy that only exists in the deployed DB via the archived
--       BossNyumba lineage (packages/database/.archive/migrations/), which is
--       out of band for this repo's runners.
--
-- IDEMPOTENT: every block is `DROP POLICY IF EXISTS` + `CREATE POLICY`, guarded
-- by an `information_schema.tables` existence check so it is safe to apply on a
-- shard where a given feature table has not been created, and safe to re-run.
-- No table data is touched.

BEGIN;

-- =============================================================================
-- Helper note: tenant_id cast convention
--   ::text cast  -> source column is UUID  (0077, 0079, 0081, 0082, 0086, 0092)
--   bare compare -> source column is TEXT  (all others below)
-- =============================================================================

-- ---- 0077_pilot_feedback.sql : pilot_feedback (uuid) ------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='pilot_feedback') THEN
    DROP POLICY IF EXISTS pilot_feedback_tenant_isolation ON pilot_feedback;
    CREATE POLICY pilot_feedback_tenant_isolation ON pilot_feedback
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0079_owner_brief_snapshots.sql : owner_brief_snapshots (uuid) ----------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='owner_brief_snapshots') THEN
    DROP POLICY IF EXISTS obs_tenant_isolation ON owner_brief_snapshots;
    CREATE POLICY obs_tenant_isolation ON owner_brief_snapshots
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0081_mining_escalations_approvals.sql : mining_escalations (uuid) ------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='mining_escalations') THEN
    DROP POLICY IF EXISTS mining_escalations_tenant_isolation ON mining_escalations;
    CREATE POLICY mining_escalations_tenant_isolation ON mining_escalations
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0081_mining_escalations_approvals.sql : mining_approval_items (uuid) ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='mining_approval_items') THEN
    DROP POLICY IF EXISTS mining_approval_items_tenant_isolation ON mining_approval_items;
    CREATE POLICY mining_approval_items_tenant_isolation ON mining_approval_items
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0082_misc_pre_launch_tables.sql : mining_sic_pings (uuid) --------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='mining_sic_pings') THEN
    DROP POLICY IF EXISTS mining_sic_pings_tenant_isolation ON mining_sic_pings;
    CREATE POLICY mining_sic_pings_tenant_isolation ON mining_sic_pings
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0083_document_intelligence.sql : document_intelligence_sessions (text) -
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='document_intelligence_sessions') THEN
    DROP POLICY IF EXISTS dis_tenant_isolation ON document_intelligence_sessions;
    CREATE POLICY dis_tenant_isolation ON document_intelligence_sessions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0083_document_intelligence.sql : document_corpus_links (text) ----------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='document_corpus_links') THEN
    DROP POLICY IF EXISTS dcl_tenant_isolation ON document_corpus_links;
    CREATE POLICY dcl_tenant_isolation ON document_corpus_links
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0086_workforce_invitations.sql : workforce_invitations (uuid) ----------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='workforce_invitations') THEN
    DROP POLICY IF EXISTS workforce_invitations_tenant_isolation ON workforce_invitations;
    CREATE POLICY workforce_invitations_tenant_isolation ON workforce_invitations
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0091_workforce_role_tab_configs.sql : workforce_role_tab_configs (text)-
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='workforce_role_tab_configs') THEN
    DROP POLICY IF EXISTS workforce_role_tab_configs_tenant_isolation ON workforce_role_tab_configs;
    CREATE POLICY workforce_role_tab_configs_tenant_isolation ON workforce_role_tab_configs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0091_workforce_role_tab_configs.sql : workforce_tab_change_requests (text)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='workforce_tab_change_requests') THEN
    DROP POLICY IF EXISTS workforce_tab_change_requests_tenant_isolation ON workforce_tab_change_requests;
    CREATE POLICY workforce_tab_change_requests_tenant_isolation ON workforce_tab_change_requests
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0092_tenant_daily_brief_prefs.sql : daily_brief_dispatches (uuid) ------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='daily_brief_dispatches') THEN
    DROP POLICY IF EXISTS dbd_tenant_isolation ON daily_brief_dispatches;
    CREATE POLICY dbd_tenant_isolation ON daily_brief_dispatches
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0093_full_mining_operations_scope.sql : external_parties (text) --------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='external_parties') THEN
    DROP POLICY IF EXISTS external_parties_tenant_isolation ON external_parties;
    CREATE POLICY external_parties_tenant_isolation ON external_parties
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0093_full_mining_operations_scope.sql : external_party_engagements (text)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='external_party_engagements') THEN
    DROP POLICY IF EXISTS epe_tenant_isolation ON external_party_engagements;
    CREATE POLICY epe_tenant_isolation ON external_party_engagements
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0093_full_mining_operations_scope.sql : mineral_chain_of_custody (text)-
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='mineral_chain_of_custody') THEN
    DROP POLICY IF EXISTS cco_tenant_isolation ON mineral_chain_of_custody;
    CREATE POLICY cco_tenant_isolation ON mineral_chain_of_custody
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0093_full_mining_operations_scope.sql : regulatory_filings (text) ------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='regulatory_filings') THEN
    DROP POLICY IF EXISTS rf_tenant_isolation ON regulatory_filings;
    CREATE POLICY rf_tenant_isolation ON regulatory_filings
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0094_mining_estate_holdings.sql : estate_groups (text) -----------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='estate_groups') THEN
    DROP POLICY IF EXISTS estate_groups_tenant_isolation ON estate_groups;
    CREATE POLICY estate_groups_tenant_isolation ON estate_groups
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0094_mining_estate_holdings.sql : estate_entities (text) ---------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='estate_entities') THEN
    DROP POLICY IF EXISTS estate_entities_tenant_isolation ON estate_entities;
    CREATE POLICY estate_entities_tenant_isolation ON estate_entities
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0094_mining_estate_holdings.sql : estate_capital_movements (text) ------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='estate_capital_movements') THEN
    DROP POLICY IF EXISTS ecm_tenant_isolation ON estate_capital_movements;
    CREATE POLICY ecm_tenant_isolation ON estate_capital_movements
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0094_mining_estate_holdings.sql : succession_plans (text) --------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='succession_plans') THEN
    DROP POLICY IF EXISTS sp_tenant_isolation ON succession_plans;
    CREATE POLICY sp_tenant_isolation ON succession_plans
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0094_mining_estate_holdings.sql : estate_assets (text) -----------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='estate_assets') THEN
    DROP POLICY IF EXISTS estate_assets_tenant_isolation ON estate_assets;
    CREATE POLICY estate_assets_tenant_isolation ON estate_assets
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0096_scope_nodes_taxonomy.sql : scope_nodes (text) ---------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='scope_nodes') THEN
    DROP POLICY IF EXISTS scope_nodes_tenant_isolation ON scope_nodes;
    CREATE POLICY scope_nodes_tenant_isolation ON scope_nodes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0096_scope_nodes_taxonomy.sql : scope_taxonomy_preferences (text) ------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='scope_taxonomy_preferences') THEN
    DROP POLICY IF EXISTS stp_tenant_isolation ON scope_taxonomy_preferences;
    CREATE POLICY stp_tenant_isolation ON scope_taxonomy_preferences
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0097_brain_ui_control.sql : owner_dashboard_layout (text) --------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='owner_dashboard_layout') THEN
    DROP POLICY IF EXISTS owner_dashboard_layout_tenant_isolation ON owner_dashboard_layout;
    CREATE POLICY owner_dashboard_layout_tenant_isolation ON owner_dashboard_layout
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0097_brain_ui_control.sql : ui_redesign_audit (text) -------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ui_redesign_audit') THEN
    DROP POLICY IF EXISTS ui_redesign_audit_tenant_isolation ON ui_redesign_audit;
    CREATE POLICY ui_redesign_audit_tenant_isolation ON ui_redesign_audit
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0098_owner_contact_prefs.sql : owner_contact_prefs (text) --------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='owner_contact_prefs') THEN
    DROP POLICY IF EXISTS owner_contact_prefs_tenant_isolation ON owner_contact_prefs;
    CREATE POLICY owner_contact_prefs_tenant_isolation ON owner_contact_prefs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0099_four_eye_requests.sql : four_eye_requests (text) ------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='four_eye_requests') THEN
    DROP POLICY IF EXISTS four_eye_requests_tenant_isolation ON four_eye_requests;
    CREATE POLICY four_eye_requests_tenant_isolation ON four_eye_requests
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0102_workforce_certifications.sql / 0110 (dup) : workforce_certifications (text)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='workforce_certifications') THEN
    DROP POLICY IF EXISTS workforce_certifications_tenant_isolation ON workforce_certifications;
    CREATE POLICY workforce_certifications_tenant_isolation ON workforce_certifications
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0102_workforce_certifications.sql / 0110 (dup) : workforce_cert_expiry_reminders (text)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='workforce_cert_expiry_reminders') THEN
    DROP POLICY IF EXISTS workforce_cert_expiry_reminders_tenant_isolation ON workforce_cert_expiry_reminders;
    CREATE POLICY workforce_cert_expiry_reminders_tenant_isolation ON workforce_cert_expiry_reminders
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0108_advisor_memory.sql : advisor_preferences (text) -------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='advisor_preferences') THEN
    DROP POLICY IF EXISTS advisor_preferences_tenant_isolation ON advisor_preferences;
    CREATE POLICY advisor_preferences_tenant_isolation ON advisor_preferences
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0108_advisor_memory.sql : advisor_observed_patterns (text) -------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='advisor_observed_patterns') THEN
    DROP POLICY IF EXISTS advisor_observed_patterns_tenant_isolation ON advisor_observed_patterns;
    CREATE POLICY advisor_observed_patterns_tenant_isolation ON advisor_observed_patterns
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0109_compliance_pccb_pdpa.sql : pccb_disclosures (text) ----------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='pccb_disclosures') THEN
    DROP POLICY IF EXISTS pccb_disclosures_tenant_isolation ON pccb_disclosures;
    CREATE POLICY pccb_disclosures_tenant_isolation ON pccb_disclosures
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0109_compliance_pccb_pdpa.sql : pdpa_processing_records (text) ---------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='pdpa_processing_records') THEN
    DROP POLICY IF EXISTS pdpa_processing_records_tenant_isolation ON pdpa_processing_records;
    CREATE POLICY pdpa_processing_records_tenant_isolation ON pdpa_processing_records
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0109_compliance_pccb_pdpa.sql : pdpa_subject_requests (text) -----------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='pdpa_subject_requests') THEN
    DROP POLICY IF EXISTS pdpa_subject_requests_tenant_isolation ON pdpa_subject_requests;
    CREATE POLICY pdpa_subject_requests_tenant_isolation ON pdpa_subject_requests
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0111_share_links.sql : share_links (text) ------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='share_links') THEN
    DROP POLICY IF EXISTS share_links_tenant_isolation ON share_links;
    CREATE POLICY share_links_tenant_isolation ON share_links
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0112_undo_journal.sql : undo_journal (text) ----------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='undo_journal') THEN
    DROP POLICY IF EXISTS undo_journal_tenant_isolation ON undo_journal;
    CREATE POLICY undo_journal_tenant_isolation ON undo_journal
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0113_pinned_items.sql : pinned_items (text) ----------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='pinned_items') THEN
    DROP POLICY IF EXISTS pinned_items_tenant_isolation ON pinned_items;
    CREATE POLICY pinned_items_tenant_isolation ON pinned_items
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0114_outcome_telemetry.sql : outcome_predictions (text) ----------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='outcome_predictions') THEN
    DROP POLICY IF EXISTS outcome_predictions_tenant_isolation ON outcome_predictions;
    CREATE POLICY outcome_predictions_tenant_isolation ON outcome_predictions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0114_outcome_telemetry.sql : outcome_observations (text) ---------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='outcome_observations') THEN
    DROP POLICY IF EXISTS outcome_observations_tenant_isolation ON outcome_observations;
    CREATE POLICY outcome_observations_tenant_isolation ON outcome_observations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0114_outcome_telemetry.sql : outcome_reconciliations (text) ------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='outcome_reconciliations') THEN
    DROP POLICY IF EXISTS outcome_reconciliations_tenant_isolation ON outcome_reconciliations;
    CREATE POLICY outcome_reconciliations_tenant_isolation ON outcome_reconciliations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0115_entity_index.sql : entity_index (text) ----------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='entity_index') THEN
    DROP POLICY IF EXISTS entity_index_tenant_isolation ON entity_index;
    CREATE POLICY entity_index_tenant_isolation ON entity_index
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0115_entity_index.sql : entity_cross_references (text) -----------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='entity_cross_references') THEN
    DROP POLICY IF EXISTS entity_cross_references_tenant_isolation ON entity_cross_references;
    CREATE POLICY entity_cross_references_tenant_isolation ON entity_cross_references
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0116_decision_journal.sql : decisions (text) ---------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='decisions') THEN
    DROP POLICY IF EXISTS decisions_tenant_isolation ON decisions;
    CREATE POLICY decisions_tenant_isolation ON decisions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0116_decision_journal.sql : decision_outcomes (text) -------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='decision_outcomes') THEN
    DROP POLICY IF EXISTS decision_outcomes_tenant_isolation ON decision_outcomes;
    CREATE POLICY decision_outcomes_tenant_isolation ON decision_outcomes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0116_decision_journal.sql : decision_links (text) ----------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='decision_links') THEN
    DROP POLICY IF EXISTS decision_links_tenant_isolation ON decision_links;
    CREATE POLICY decision_links_tenant_isolation ON decision_links
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0137_chat_handoffs.sql : chat_handoffs (text) --------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='chat_handoffs') THEN
    DROP POLICY IF EXISTS chat_handoffs_tenant_isolation ON chat_handoffs;
    CREATE POLICY chat_handoffs_tenant_isolation ON chat_handoffs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ---- 0142_tab_proposals_inbox.sql : tab_proposals_inbox (text) --------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='tab_proposals_inbox') THEN
    DROP POLICY IF EXISTS tab_proposals_inbox_tenant_isolation ON tab_proposals_inbox;
    CREATE POLICY tab_proposals_inbox_tenant_isolation ON tab_proposals_inbox
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
