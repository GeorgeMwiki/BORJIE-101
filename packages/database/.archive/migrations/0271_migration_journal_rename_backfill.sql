-- ============================================================================
-- BUG-CR-2 fix: backfill drizzle.__drizzle_migrations for P72's 25 renames.
--
-- Context:
--   P72 (commit 88a7e2bc) renamed 25 colliding migration filenames using a
--   ?b/?c suffix convention (e.g. 0017_gepg → 0017b_gepg, 0179_rls_policies
--   → 0179b_rls_policies). On any database that had already applied the
--   ORIGINAL filenames, the journal table contained the old hashes; the
--   migration runner (`packages/database/src/run-migrations.ts`) would then
--   see the renamed files as un-applied and re-run all 25 of them on next
--   boot. Most renamed SQL is wrapped (CREATE TABLE IF NOT EXISTS, DO $$
--   blocks with DROP POLICY IF EXISTS, etc.) so the re-application would
--   succeed in most cases — but the noise would mask real failures and any
--   single non-idempotent statement could crash the deploy.
--
-- Hash algorithm:
--   This project uses a CUSTOM migration runner (NOT drizzle-kit). The hash
--   stored in `drizzle.__drizzle_migrations.hash` is the bare filename with
--   the `.sql` suffix stripped (see run-migrations.ts:87 — `name =
--   file.replace('.sql', '')`). So the backfill is a straight UPDATE of the
--   hash column from the OLD basename to the NEW basename.
--
-- Idempotency:
--   - Safe to run multiple times: each UPDATE is guarded by NOT EXISTS so
--     it only fires when the OLD row is present AND the NEW row is absent.
--   - Safe on fresh databases: if drizzle.__drizzle_migrations is absent or
--     empty, every UPDATE simply touches zero rows.
-- ============================================================================

DO $$
DECLARE
  rename_pairs text[][] := ARRAY[
    ['0017_gepg',                              '0017b_gepg'],
    ['0017_inspections_extensions',            '0017c_inspections_extensions'],
    ['0017_lease_renewal_extensions',          '0017d_lease_renewal_extensions'],
    ['0017_negotiation',                       '0017e_negotiation'],
    ['0018_arrears_ledger',                    '0018b_arrears_ledger'],
    ['0018_conditional_surveys',               '0018c_conditional_surveys'],
    ['0018_marketplace',                       '0018d_marketplace'],
    ['0018_tenant_finance',                    '0018e_tenant_finance'],
    ['0019_gamification',                      '0019b_gamification'],
    ['0019_intelligence_history',              '0019c_intelligence_history'],
    ['0019_waitlist',                          '0019d_waitlist'],
    ['0020_tenant_risk_reports',               '0020b_tenant_risk_reports'],
    ['0023_station_master_coverage',           '0023b_station_master_coverage'],
    ['0164_portal_layouts',                    '0164b_portal_layouts'],
    ['0164_sovereign_append_only_enforcement', '0164c_sovereign_append_only_enforcement'],
    ['0164_spatial_parcels',                   '0164d_spatial_parcels'],
    ['0165_worm_audit_log',                    '0165b_worm_audit_log'],
    ['0166_rls_promote_out_wave',              '0166b_rls_promote_out_wave'],
    ['0167_payments_ledger_drizzle',           '0167b_payments_ledger_drizzle'],
    ['0168_kill_switch_feature_flags',         '0168b_kill_switch_feature_flags'],
    ['0169_payments_ledger_rls',               '0169b_payments_ledger_rls'],
    ['0170_kill_switch_expand',                '0170b_kill_switch_expand'],
    ['0172_unify_rls_guc',                     '0172b_unify_rls_guc'],
    ['0174_strategic_report_history',          '0174b_strategic_report_history'],
    ['0179_rls_policies',                      '0179b_rls_policies']
  ];
  pair text[];
  old_hash text;
  new_hash text;
  updated_count int;
BEGIN
  -- Confirm the journal table exists. The runner creates it lazily on first
  -- run; on a fresh DB it may not exist yet, in which case there's nothing
  -- to backfill and this migration is a no-op.
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'drizzle'
       AND table_name   = '__drizzle_migrations'
  ) THEN
    RAISE NOTICE 'BUG-CR-2 backfill: drizzle.__drizzle_migrations absent (fresh DB) — skipping';
    RETURN;
  END IF;

  FOREACH pair SLICE 1 IN ARRAY rename_pairs LOOP
    old_hash := pair[1];
    new_hash := pair[2];

    -- Only update when the OLD hash exists AND the NEW hash does not.
    -- This makes the migration idempotent on re-run and a safe no-op when
    -- the journal already reflects the renamed files (e.g. fresh deploy
    -- after P72 picked up the new names directly).
    UPDATE drizzle.__drizzle_migrations
       SET hash = new_hash
     WHERE hash = old_hash
       AND NOT EXISTS (
         SELECT 1
           FROM drizzle.__drizzle_migrations m2
          WHERE m2.hash = new_hash
       );

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count > 0 THEN
      RAISE NOTICE 'BUG-CR-2 backfill: % -> % (% row)', old_hash, new_hash, updated_count;
    END IF;
  END LOOP;
END $$;
