-- =============================================================================
-- DOWN 0101: revert universal `provenance` column.
--
-- Drops the `provenance` jsonb column + its GIN index on every table
-- the up migration touched. Idempotent (`IF EXISTS`).
--
-- WARNING: DATA LOSS — destroys the chat/form/agent/api/legacy
-- provenance metadata stamped on every row. Down only on dev /
-- staging.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reminders',
    'owner_tabs',
    'workforce_tab_change_requests',
    'document_drafts',
    'draft_revisions',
    'incidents',
    'shift_reports',
    'sales',
    'estate_capital_movements',
    'external_party_engagements',
    'mineral_chain_of_custody',
    'regulatory_filings',
    'marketplace_bids',
    'bid_negotiations',
    'workforce_role_tab_configs',
    'mining_tasks',
    'mining_escalations',
    'mining_approval_items',
    'pilot_feedback',
    'workforce_invitations',
    'external_parties',
    'estate_assets'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP INDEX IF EXISTS %I', t || '_provenance_gin');
      EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS provenance', t);
    END IF;
  END LOOP;
END$$;

COMMIT;
