-- =============================================================================
-- Migration 0297 — Repoint the DYNAMICALLY-generated drizzle/ RLS policies from
-- the legacy `app.tenant_id` GUC onto the canonical `app.current_tenant_id`
-- GUC that api-gateway's request connection actually binds, and promote every
-- affected table to FORCE ROW LEVEL SECURITY.
--
-- WHY THIS MIGRATION EXISTS (identical failure mode to 0150 / 0156 / 0157 / 0296)
-- -----------------------------------------------------------------------------
-- The api-gateway request path binds ONLY the canonical GUC
-- (services/api-gateway/src/middleware/database.ts ->
--  set_config('app.current_tenant_id', <tenant>, false)). A FORCE-RLS policy
-- whose predicate reads `current_setting('app.tenant_id', true)` therefore
-- evaluates `NULL = tenant_id` -> NULL, which Postgres treats as FALSE under
-- RLS: every authenticated read AND write against the table silently
-- returns / affects ZERO rows. The Supabase `service_role` connection has
-- BYPASSRLS, so out-of-band tooling never tripped it.
--
--   0150 fixed request_for_bids / request_for_bid_responses /
--        owner_delegation_prefs / mwikila_actions_inbox.
--   0156 fixed reminders / owner_tabs.
--   0157 fixed the 46 in-tree LITERAL `CREATE POLICY` tables under
--        src/migrations/ (0077..0142).
--   0296 fixed recommendation_runs / recommendation_feedback.
--
-- This migration (0297) closes the LAST remaining bucket: the
-- packages/database/drizzle/ lineage, which builds RLS via
-- `EXECUTE format('… current_setting(''app.tenant_id'', true) …')` FOREACH
-- loops over static table arrays PLUS literal `CREATE POLICY` statements that
-- all read the legacy GUC. These are drift items DR-3 / DR-7 / DR-8 in
-- packages/database/MIGRATION_RECONCILIATION.md. The archived helper-function
-- unifier (.archive/migrations/0172b_unify_rls_guc.sql) only repointed policies
-- that call `public.current_app_tenant_id()`; it does NOT rescue these INLINE
-- `current_setting('app.tenant_id', …)` predicates (the entire Borjie drizzle
-- style), so they remain fail-closed until this repoint lands.
--
-- WHAT THIS MIGRATION DOES (idempotent, forward-only)
--   For EACH still-broken (table, policy):
--     1. DROP POLICY IF EXISTS <name> ON <table>;
--     2. re-CREATE the SAME policy (name, FOR-clause, USING / WITH CHECK shape,
--        EXISTS-subquery / NULL-OR / seed predicate) byte-for-byte from its
--        drizzle/ source, with the GUC name as the ONLY change.
--     3. ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ... FORCE ROW LEVEL
--        SECURITY;  (CLAUDE.md hard rule — the drizzle/ loops only `ENABLE`d,
--        never `FORCE`d; this also closes DR-8 for the 0003 family).
--
-- CAST CONVENTION (mirrors 0157): every `tenant_id` column in the drizzle/
-- lineage is TEXT, so the predicate compares BARE (`tenant_id =
-- current_setting(...)`) — there are no UUID-typed tenant columns in this
-- bucket, hence no `::text` casts (unlike 0157, whose src/migrations/ lineage
-- had a few UUID columns). The three platform-shared tables
-- (intelligence_corpus_chunks, ratings, equipment_maintenance_taxonomy) keep
-- their `tenant_id IS NULL OR …` shape; the subquery-scoped tables
-- (research_steps/artifacts/results, mutation_approvals/history,
-- capability_outcomes) keep their parent-EXISTS shape; agent_turns /
-- junior_turn_feedback keep their read(USING)+write(FOR INSERT WITH CHECK)
-- split; kpi_templates keeps its `OR tenant_id = '__seed__'` read.
--
-- SCOPE (deliberately bounded)
--   * EXCLUDES recommendation_runs / recommendation_feedback — already
--     repointed + FORCEd by 0296.
--   * EXCLUDES tables that only exist in the archived BossNyumba lineage
--     (.archive/migrations/), which is out of band for this repo's runners.
--   * Property-domain relics (vendor_*, maintenance_requests, inspections,
--     utility_*, sublease_requests, …) are DROPped by drizzle/0003 and carry no
--     surviving policy, so they are naturally absent here.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md: migrations are immutable +
-- forward-only). Every block is guarded by an information_schema.tables
-- existence check + DROP POLICY IF EXISTS, so it is a no-op on a shard where a
-- given feature table has not been created and safe to re-run. No table data is
-- touched. Replaying the source drizzle/ migration followed by 0297 lands the
-- correct end state (the exact discipline 0157 / 0296 follow).
--
-- This file lives in src/migrations/ (applied by run-migrations.ts AFTER the
-- drizzle/ baseline) rather than in drizzle/; both runners share the same
-- `drizzle.__drizzle_migrations` ledger and the same database, and DROP/CREATE
-- POLICY targets the live table by name regardless of which lineage created it,
-- so the repoint takes effect identically. (run-migrations.ts applies drizzle/
-- baseline first, then src/migrations/ deltas — see its header.)
--
-- Companion: packages/database/MIGRATION_RECONCILIATION.md (DR-3 / DR-7 / DR-8).
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- from drizzle/0003_mining_domain.sql
-- ----------------------------------------------------------------------------

-- advances.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'advances') THEN
    DROP POLICY IF EXISTS tenant_isolation ON advances;
    CREATE POLICY tenant_isolation ON advances
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE advances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE advances FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- assets.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'assets') THEN
    DROP POLICY IF EXISTS tenant_isolation ON assets;
    CREATE POLICY tenant_isolation ON assets
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE assets FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- attendance.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'attendance') THEN
    DROP POLICY IF EXISTS tenant_isolation ON attendance;
    CREATE POLICY tenant_isolation ON attendance
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
    ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- authorities.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'authorities') THEN
    DROP POLICY IF EXISTS tenant_isolation ON authorities;
    CREATE POLICY tenant_isolation ON authorities
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE authorities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE authorities FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- bank_accounts.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'bank_accounts') THEN
    DROP POLICY IF EXISTS tenant_isolation ON bank_accounts;
    CREATE POLICY tenant_isolation ON bank_accounts
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- buyers.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'buyers') THEN
    DROP POLICY IF EXISTS tenant_isolation ON buyers;
    CREATE POLICY tenant_isolation ON buyers
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE buyers FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- cash_balances.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cash_balances') THEN
    DROP POLICY IF EXISTS tenant_isolation ON cash_balances;
    CREATE POLICY tenant_isolation ON cash_balances
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE cash_balances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cash_balances FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- companies.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'companies') THEN
    DROP POLICY IF EXISTS tenant_isolation ON companies;
    CREATE POLICY tenant_isolation ON companies
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE companies FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- costs.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'costs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON costs;
    CREATE POLICY tenant_isolation ON costs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE costs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE costs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- csr_plans.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'csr_plans') THEN
    DROP POLICY IF EXISTS tenant_isolation ON csr_plans;
    CREATE POLICY tenant_isolation ON csr_plans
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE csr_plans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE csr_plans FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- directors.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'directors') THEN
    DROP POLICY IF EXISTS tenant_isolation ON directors;
    CREATE POLICY tenant_isolation ON directors
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE directors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE directors FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- drill_hole_layers.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'drill_hole_layers') THEN
    DROP POLICY IF EXISTS tenant_isolation ON drill_hole_layers;
    CREATE POLICY tenant_isolation ON drill_hole_layers
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE drill_hole_layers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE drill_hole_layers FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- drill_holes.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'drill_holes') THEN
    DROP POLICY IF EXISTS tenant_isolation ON drill_holes;
    CREATE POLICY tenant_isolation ON drill_holes
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE drill_holes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE drill_holes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- employees.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'employees') THEN
    DROP POLICY IF EXISTS tenant_isolation ON employees;
    CREATE POLICY tenant_isolation ON employees
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE employees FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- fingerprint_events.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'fingerprint_events') THEN
    DROP POLICY IF EXISTS tenant_isolation ON fingerprint_events;
    CREATE POLICY tenant_isolation ON fingerprint_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE fingerprint_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fingerprint_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- forecasts.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'forecasts') THEN
    DROP POLICY IF EXISTS tenant_isolation ON forecasts;
    CREATE POLICY tenant_isolation ON forecasts
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE forecasts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- fuel_logs.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'fuel_logs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON fuel_logs;
    CREATE POLICY tenant_isolation ON fuel_logs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE fuel_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fuel_logs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- grievances.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'grievances') THEN
    DROP POLICY IF EXISTS tenant_isolation ON grievances;
    CREATE POLICY tenant_isolation ON grievances
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE grievances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE grievances FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- incidents.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'incidents') THEN
    DROP POLICY IF EXISTS tenant_isolation ON incidents;
    CREATE POLICY tenant_isolation ON incidents
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- intelligence_corpus_chunks.tenant_or_global  (src: drizzle/0003_mining_domain.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'intelligence_corpus_chunks') THEN
    DROP POLICY IF EXISTS tenant_or_global ON intelligence_corpus_chunks;
    CREATE POLICY tenant_or_global ON intelligence_corpus_chunks
      USING (
      tenant_id IS NULL
      OR tenant_id = current_setting('app.current_tenant_id', true)
      );
    ALTER TABLE intelligence_corpus_chunks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE intelligence_corpus_chunks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- licence_events.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'licence_events') THEN
    DROP POLICY IF EXISTS tenant_isolation ON licence_events;
    CREATE POLICY tenant_isolation ON licence_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE licence_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE licence_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- licences.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'licences') THEN
    DROP POLICY IF EXISTS tenant_isolation ON licences;
    CREATE POLICY tenant_isolation ON licences
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE licences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE licences FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- maintenance_events.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'maintenance_events') THEN
    DROP POLICY IF EXISTS tenant_isolation ON maintenance_events;
    CREATE POLICY tenant_isolation ON maintenance_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE maintenance_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- marketplace_listings.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'marketplace_listings') THEN
    DROP POLICY IF EXISTS tenant_isolation ON marketplace_listings;
    CREATE POLICY tenant_isolation ON marketplace_listings
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE marketplace_listings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ore_parcels.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ore_parcels') THEN
    DROP POLICY IF EXISTS tenant_isolation ON ore_parcels;
    CREATE POLICY tenant_isolation ON ore_parcels
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ore_parcels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ore_parcels FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ppe_issues.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ppe_issues') THEN
    DROP POLICY IF EXISTS tenant_isolation ON ppe_issues;
    CREATE POLICY tenant_isolation ON ppe_issues
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ppe_issues ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ppe_issues FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- production_records.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'production_records') THEN
    DROP POLICY IF EXISTS tenant_isolation ON production_records;
    CREATE POLICY tenant_isolation ON production_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE production_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ratings.tenant_or_global  (src: drizzle/0003_mining_domain.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ratings') THEN
    DROP POLICY IF EXISTS tenant_or_global ON ratings;
    CREATE POLICY tenant_or_global ON ratings
      USING (
      tenant_id IS NULL
      OR tenant_id = current_setting('app.current_tenant_id', true)
      );
    ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ratings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- risks.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'risks') THEN
    DROP POLICY IF EXISTS tenant_isolation ON risks;
    CREATE POLICY tenant_isolation ON risks
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE risks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- sales.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'sales') THEN
    DROP POLICY IF EXISTS tenant_isolation ON sales;
    CREATE POLICY tenant_isolation ON sales
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sales FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- samples.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'samples') THEN
    DROP POLICY IF EXISTS tenant_isolation ON samples;
    CREATE POLICY tenant_isolation ON samples
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE samples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE samples FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- shareholders.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'shareholders') THEN
    DROP POLICY IF EXISTS tenant_isolation ON shareholders;
    CREATE POLICY tenant_isolation ON shareholders
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE shareholders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shareholders FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- shift_reports.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'shift_reports') THEN
    DROP POLICY IF EXISTS tenant_isolation ON shift_reports;
    CREATE POLICY tenant_isolation ON shift_reports
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE shift_reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shift_reports FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- site_sections.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'site_sections') THEN
    DROP POLICY IF EXISTS tenant_isolation ON site_sections;
    CREATE POLICY tenant_isolation ON site_sections
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE site_sections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE site_sections FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- sites.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'sites') THEN
    DROP POLICY IF EXISTS tenant_isolation ON sites;
    CREATE POLICY tenant_isolation ON sites
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sites FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tasks.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tasks') THEN
    DROP POLICY IF EXISTS tenant_isolation ON tasks;
    CREATE POLICY tenant_isolation ON tasks
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- vein_models.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'vein_models') THEN
    DROP POLICY IF EXISTS tenant_isolation ON vein_models;
    CREATE POLICY tenant_isolation ON vein_models
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE vein_models ENABLE ROW LEVEL SECURITY;
    ALTER TABLE vein_models FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- village_meetings.tenant_isolation  (src: drizzle/0003_mining_domain.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'village_meetings') THEN
    DROP POLICY IF EXISTS tenant_isolation ON village_meetings;
    CREATE POLICY tenant_isolation ON village_meetings
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE village_meetings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE village_meetings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0004_marketplace_bids.sql
-- ----------------------------------------------------------------------------

-- marketplace_bids.tenant_isolation  (src: drizzle/0004_marketplace_bids.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'marketplace_bids') THEN
    DROP POLICY IF EXISTS tenant_isolation ON marketplace_bids;
    CREATE POLICY tenant_isolation ON marketplace_bids
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE marketplace_bids ENABLE ROW LEVEL SECURITY;
    ALTER TABLE marketplace_bids FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0007_mining_workforce_extensions.sql
-- ----------------------------------------------------------------------------

-- equipment_maintenance_taxonomy.tenant_isolation  (src: drizzle/0007_mining_workforce_extensions.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'equipment_maintenance_taxonomy') THEN
    DROP POLICY IF EXISTS tenant_isolation ON equipment_maintenance_taxonomy;
    CREATE POLICY tenant_isolation ON equipment_maintenance_taxonomy
      USING (
      tenant_id IS NULL
      OR tenant_id = current_setting('app.current_tenant_id', true)
      );
    ALTER TABLE equipment_maintenance_taxonomy ENABLE ROW LEVEL SECURITY;
    ALTER TABLE equipment_maintenance_taxonomy FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- offtake_queue.tenant_isolation  (src: drizzle/0007_mining_workforce_extensions.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'offtake_queue') THEN
    DROP POLICY IF EXISTS tenant_isolation ON offtake_queue;
    CREATE POLICY tenant_isolation ON offtake_queue
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE offtake_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE offtake_queue FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- pre_shift_inspections.tenant_isolation  (src: drizzle/0007_mining_workforce_extensions.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pre_shift_inspections') THEN
    DROP POLICY IF EXISTS tenant_isolation ON pre_shift_inspections;
    CREATE POLICY tenant_isolation ON pre_shift_inspections
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE pre_shift_inspections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pre_shift_inspections FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- site_supervisor_coverage.tenant_isolation  (src: drizzle/0007_mining_workforce_extensions.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'site_supervisor_coverage') THEN
    DROP POLICY IF EXISTS tenant_isolation ON site_supervisor_coverage;
    CREATE POLICY tenant_isolation ON site_supervisor_coverage
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE site_supervisor_coverage ENABLE ROW LEVEL SECURITY;
    ALTER TABLE site_supervisor_coverage FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- worker_incentives.tenant_isolation  (src: drizzle/0007_mining_workforce_extensions.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'worker_incentives') THEN
    DROP POLICY IF EXISTS tenant_isolation ON worker_incentives;
    CREATE POLICY tenant_isolation ON worker_incentives
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE worker_incentives ENABLE ROW LEVEL SECURITY;
    ALTER TABLE worker_incentives FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0013_routing_rules.sql
-- ----------------------------------------------------------------------------

-- executive_brief_actions.tenant_isolation  (src: drizzle/0013_routing_rules.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'executive_brief_actions') THEN
    DROP POLICY IF EXISTS tenant_isolation ON executive_brief_actions;
    CREATE POLICY tenant_isolation ON executive_brief_actions
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE executive_brief_actions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE executive_brief_actions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- routing_rules.tenant_isolation  (src: drizzle/0013_routing_rules.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'routing_rules') THEN
    DROP POLICY IF EXISTS tenant_isolation ON routing_rules;
    CREATE POLICY tenant_isolation ON routing_rules
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE routing_rules FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0018_deep_research.sql
-- ----------------------------------------------------------------------------

-- continuous_watches.tenant_isolation  (src: drizzle/0018_deep_research.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'continuous_watches') THEN
    DROP POLICY IF EXISTS tenant_isolation ON continuous_watches;
    CREATE POLICY tenant_isolation ON continuous_watches
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE continuous_watches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE continuous_watches FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- research_artifacts.tenant_isolation  (src: drizzle/0018_deep_research.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'research_artifacts') THEN
    DROP POLICY IF EXISTS tenant_isolation ON research_artifacts;
    CREATE POLICY tenant_isolation ON research_artifacts
      USING (
      step_id IN (
      SELECT s.id FROM research_steps s
      JOIN research_plans p ON s.plan_id = p.id
      WHERE p.tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE research_artifacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE research_artifacts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- research_plans.tenant_isolation  (src: drizzle/0018_deep_research.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'research_plans') THEN
    DROP POLICY IF EXISTS tenant_isolation ON research_plans;
    CREATE POLICY tenant_isolation ON research_plans
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE research_plans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE research_plans FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- research_results.tenant_isolation  (src: drizzle/0018_deep_research.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'research_results') THEN
    DROP POLICY IF EXISTS tenant_isolation ON research_results;
    CREATE POLICY tenant_isolation ON research_results
      USING (
      plan_id IN (
      SELECT id FROM research_plans
      WHERE tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE research_results ENABLE ROW LEVEL SECURITY;
    ALTER TABLE research_results FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- research_sessions.tenant_isolation  (src: drizzle/0018_deep_research.sql · loop)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'research_sessions') THEN
    DROP POLICY IF EXISTS tenant_isolation ON research_sessions;
    CREATE POLICY tenant_isolation ON research_sessions
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE research_sessions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- research_steps.tenant_isolation  (src: drizzle/0018_deep_research.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'research_steps') THEN
    DROP POLICY IF EXISTS tenant_isolation ON research_steps;
    CREATE POLICY tenant_isolation ON research_steps
      USING (
      plan_id IN (
      SELECT id FROM research_plans
      WHERE tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE research_steps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE research_steps FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0023_mutation_authority.sql
-- ----------------------------------------------------------------------------

-- mutation_approvals.mutation_approvals_tenant_read  (src: drizzle/0023_mutation_authority.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mutation_approvals') THEN
    DROP POLICY IF EXISTS mutation_approvals_tenant_read ON mutation_approvals;
    CREATE POLICY mutation_approvals_tenant_read ON mutation_approvals
      USING (
      EXISTS (
      SELECT 1
      FROM mutation_proposals p
      WHERE p.id = mutation_approvals.proposal_id
      AND p.tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE mutation_approvals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mutation_approvals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- mutation_history.mutation_history_tenant_read  (src: drizzle/0023_mutation_authority.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mutation_history') THEN
    DROP POLICY IF EXISTS mutation_history_tenant_read ON mutation_history;
    CREATE POLICY mutation_history_tenant_read ON mutation_history
      USING (
      EXISTS (
      SELECT 1
      FROM mutation_proposals p
      WHERE p.id = mutation_history.proposal_id
      AND p.tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE mutation_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mutation_history FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- mutation_proposals.mutation_proposals_tenant_read  (src: drizzle/0023_mutation_authority.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mutation_proposals') THEN
    DROP POLICY IF EXISTS mutation_proposals_tenant_read ON mutation_proposals;
    CREATE POLICY mutation_proposals_tenant_read ON mutation_proposals
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE mutation_proposals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mutation_proposals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- second_authoriser_assignments.second_authoriser_tenant_read  (src: drizzle/0023_mutation_authority.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'second_authoriser_assignments') THEN
    DROP POLICY IF EXISTS second_authoriser_tenant_read ON second_authoriser_assignments;
    CREATE POLICY second_authoriser_tenant_read ON second_authoriser_assignments
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE second_authoriser_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE second_authoriser_assignments FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0025_junior_architecture.sql
-- ----------------------------------------------------------------------------

-- agent_turns.agent_turns_tenant_read  (src: drizzle/0025_junior_architecture.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'agent_turns') THEN
    DROP POLICY IF EXISTS agent_turns_tenant_read ON agent_turns;
    CREATE POLICY agent_turns_tenant_read ON agent_turns
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE agent_turns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_turns FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- agent_turns.agent_turns_tenant_write  (src: drizzle/0025_junior_architecture.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'agent_turns') THEN
    DROP POLICY IF EXISTS agent_turns_tenant_write ON agent_turns;
    CREATE POLICY agent_turns_tenant_write ON agent_turns
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE agent_turns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_turns FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0027_geo_routing_session_scopes.sql
-- ----------------------------------------------------------------------------

-- customer_district_assignments.tenant_isolation  (src: drizzle/0027_geo_routing_session_scopes.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'customer_district_assignments') THEN
    DROP POLICY IF EXISTS tenant_isolation ON customer_district_assignments;
    CREATE POLICY tenant_isolation ON customer_district_assignments
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE customer_district_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_district_assignments FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- customer_locations.tenant_isolation  (src: drizzle/0027_geo_routing_session_scopes.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'customer_locations') THEN
    DROP POLICY IF EXISTS tenant_isolation ON customer_locations;
    CREATE POLICY tenant_isolation ON customer_locations
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE customer_locations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_locations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- org_unit_service_areas.tenant_isolation  (src: drizzle/0027_geo_routing_session_scopes.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'org_unit_service_areas') THEN
    DROP POLICY IF EXISTS tenant_isolation ON org_unit_service_areas;
    CREATE POLICY tenant_isolation ON org_unit_service_areas
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE org_unit_service_areas ENABLE ROW LEVEL SECURITY;
    ALTER TABLE org_unit_service_areas FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- session_scopes.tenant_isolation  (src: drizzle/0027_geo_routing_session_scopes.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session_scopes') THEN
    DROP POLICY IF EXISTS tenant_isolation ON session_scopes;
    CREATE POLICY tenant_isolation ON session_scopes
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE session_scopes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE session_scopes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0028_junior_dynamic_lifecycle.sql
-- ----------------------------------------------------------------------------

-- junior_turn_feedback.junior_turn_feedback_tenant_read  (src: drizzle/0028_junior_dynamic_lifecycle.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'junior_turn_feedback') THEN
    DROP POLICY IF EXISTS junior_turn_feedback_tenant_read ON junior_turn_feedback;
    CREATE POLICY junior_turn_feedback_tenant_read ON junior_turn_feedback
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE junior_turn_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE junior_turn_feedback FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- junior_turn_feedback.junior_turn_feedback_tenant_write  (src: drizzle/0028_junior_dynamic_lifecycle.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'junior_turn_feedback') THEN
    DROP POLICY IF EXISTS junior_turn_feedback_tenant_write ON junior_turn_feedback;
    CREATE POLICY junior_turn_feedback_tenant_write ON junior_turn_feedback
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE junior_turn_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE junior_turn_feedback FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0029_cognitive_memory.sql
-- ----------------------------------------------------------------------------

-- cognitive_memory_cells.cmc_tenant_isolation  (src: drizzle/0029_cognitive_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cognitive_memory_cells') THEN
    DROP POLICY IF EXISTS cmc_tenant_isolation ON cognitive_memory_cells;
    CREATE POLICY cmc_tenant_isolation ON cognitive_memory_cells
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE cognitive_memory_cells ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cognitive_memory_cells FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- cognitive_memory_reinforcements.cmr_tenant_isolation  (src: drizzle/0029_cognitive_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cognitive_memory_reinforcements') THEN
    DROP POLICY IF EXISTS cmr_tenant_isolation ON cognitive_memory_reinforcements;
    CREATE POLICY cmr_tenant_isolation ON cognitive_memory_reinforcements
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE cognitive_memory_reinforcements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cognitive_memory_reinforcements FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0030_persistent_memory.sql
-- ----------------------------------------------------------------------------

-- pending_threads.pending_threads_tenant_isolation  (src: drizzle/0030_persistent_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pending_threads') THEN
    DROP POLICY IF EXISTS pending_threads_tenant_isolation ON pending_threads;
    CREATE POLICY pending_threads_tenant_isolation ON pending_threads
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE pending_threads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pending_threads FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- session_memory.session_memory_tenant_isolation  (src: drizzle/0030_persistent_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session_memory') THEN
    DROP POLICY IF EXISTS session_memory_tenant_isolation ON session_memory;
    CREATE POLICY session_memory_tenant_isolation ON session_memory
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE session_memory ENABLE ROW LEVEL SECURITY;
    ALTER TABLE session_memory FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- skills.skills_tenant_isolation  (src: drizzle/0030_persistent_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'skills') THEN
    DROP POLICY IF EXISTS skills_tenant_isolation ON skills;
    CREATE POLICY skills_tenant_isolation ON skills
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
    ALTER TABLE skills FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- thread_summaries.thread_summaries_tenant_isolation  (src: drizzle/0030_persistent_memory.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'thread_summaries') THEN
    DROP POLICY IF EXISTS thread_summaries_tenant_isolation ON thread_summaries;
    CREATE POLICY thread_summaries_tenant_isolation ON thread_summaries
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE thread_summaries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE thread_summaries FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0031_ephemeral_dashboard.sql
-- ----------------------------------------------------------------------------

-- ephemeral_dashboard_telemetry.tenant_isolation  (src: drizzle/0031_ephemeral_dashboard.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ephemeral_dashboard_telemetry') THEN
    DROP POLICY IF EXISTS tenant_isolation ON ephemeral_dashboard_telemetry;
    CREATE POLICY tenant_isolation ON ephemeral_dashboard_telemetry
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ephemeral_dashboard_telemetry ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ephemeral_dashboard_telemetry FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0033_mcp_external_connections.sql
-- ----------------------------------------------------------------------------

-- mcp_external_connections.mcp_external_connections_tenant_rls  (src: drizzle/0033_mcp_external_connections.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mcp_external_connections') THEN
    DROP POLICY IF EXISTS mcp_external_connections_tenant_rls ON mcp_external_connections;
    CREATE POLICY mcp_external_connections_tenant_rls
      ON mcp_external_connections
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE mcp_external_connections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mcp_external_connections FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- mcp_tool_invocations.mcp_tool_invocations_tenant_rls  (src: drizzle/0033_mcp_external_connections.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mcp_tool_invocations') THEN
    DROP POLICY IF EXISTS mcp_tool_invocations_tenant_rls ON mcp_tool_invocations;
    CREATE POLICY mcp_tool_invocations_tenant_rls
      ON mcp_tool_invocations
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE mcp_tool_invocations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mcp_tool_invocations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0034_followup_voice.sql
-- ----------------------------------------------------------------------------

-- followup_candidates.followup_candidates_tenant_isolation  (src: drizzle/0034_followup_voice.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'followup_candidates') THEN
    DROP POLICY IF EXISTS followup_candidates_tenant_isolation ON followup_candidates;
    CREATE POLICY followup_candidates_tenant_isolation ON followup_candidates
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE followup_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE followup_candidates FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- followup_preferences.followup_preferences_tenant_isolation  (src: drizzle/0034_followup_voice.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'followup_preferences') THEN
    DROP POLICY IF EXISTS followup_preferences_tenant_isolation ON followup_preferences;
    CREATE POLICY followup_preferences_tenant_isolation ON followup_preferences
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE followup_preferences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE followup_preferences FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- persona_voice_mode.persona_voice_mode_tenant_isolation  (src: drizzle/0034_followup_voice.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'persona_voice_mode') THEN
    DROP POLICY IF EXISTS persona_voice_mode_tenant_isolation ON persona_voice_mode;
    CREATE POLICY persona_voice_mode_tenant_isolation ON persona_voice_mode
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE persona_voice_mode ENABLE ROW LEVEL SECURITY;
    ALTER TABLE persona_voice_mode FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0035_loop_architecture.sql
-- ----------------------------------------------------------------------------

-- loop_layer_outcomes.loop_layer_outcomes_tenant_isolation  (src: drizzle/0035_loop_architecture.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'loop_layer_outcomes') THEN
    DROP POLICY IF EXISTS loop_layer_outcomes_tenant_isolation ON loop_layer_outcomes;
    CREATE POLICY loop_layer_outcomes_tenant_isolation ON loop_layer_outcomes
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE loop_layer_outcomes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE loop_layer_outcomes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- loop_quality_signals.loop_quality_signals_tenant_isolation  (src: drizzle/0035_loop_architecture.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'loop_quality_signals') THEN
    DROP POLICY IF EXISTS loop_quality_signals_tenant_isolation ON loop_quality_signals;
    CREATE POLICY loop_quality_signals_tenant_isolation ON loop_quality_signals
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE loop_quality_signals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE loop_quality_signals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- loop_runs.loop_runs_tenant_isolation  (src: drizzle/0035_loop_architecture.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'loop_runs') THEN
    DROP POLICY IF EXISTS loop_runs_tenant_isolation ON loop_runs;
    CREATE POLICY loop_runs_tenant_isolation ON loop_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE loop_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE loop_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0036_tab_as_loop.sql
-- ----------------------------------------------------------------------------

-- tab_events.tab_events_tenant_read  (src: drizzle/0036_tab_as_loop.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tab_events') THEN
    DROP POLICY IF EXISTS tab_events_tenant_read ON tab_events;
    CREATE POLICY tab_events_tenant_read ON tab_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tab_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tab_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tab_sessions.tab_sessions_tenant_read  (src: drizzle/0036_tab_as_loop.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tab_sessions') THEN
    DROP POLICY IF EXISTS tab_sessions_tenant_read ON tab_sessions;
    CREATE POLICY tab_sessions_tenant_read ON tab_sessions
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tab_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tab_sessions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0037_calibration_interpretability.sql
-- ----------------------------------------------------------------------------

-- calibration_observations.calibration_observations_tenant_isolation  (src: drizzle/0037_calibration_interpretability.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'calibration_observations') THEN
    DROP POLICY IF EXISTS calibration_observations_tenant_isolation ON calibration_observations;
    CREATE POLICY calibration_observations_tenant_isolation
      ON calibration_observations
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE calibration_observations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE calibration_observations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- calibration_weekly_reports.calibration_weekly_reports_tenant_isolation  (src: drizzle/0037_calibration_interpretability.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'calibration_weekly_reports') THEN
    DROP POLICY IF EXISTS calibration_weekly_reports_tenant_isolation ON calibration_weekly_reports;
    CREATE POLICY calibration_weekly_reports_tenant_isolation
      ON calibration_weekly_reports
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE calibration_weekly_reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE calibration_weekly_reports FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- sae_probe_features.sae_probe_features_tenant_isolation  (src: drizzle/0037_calibration_interpretability.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'sae_probe_features') THEN
    DROP POLICY IF EXISTS sae_probe_features_tenant_isolation ON sae_probe_features;
    CREATE POLICY sae_probe_features_tenant_isolation ON sae_probe_features
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE sae_probe_features ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sae_probe_features FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0038_info_synthesis.sql
-- ----------------------------------------------------------------------------

-- synth_outputs.tenant_isolation  (src: drizzle/0038_info_synthesis.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'synth_outputs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON synth_outputs;
    CREATE POLICY tenant_isolation ON synth_outputs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE synth_outputs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE synth_outputs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- synth_runs.tenant_isolation  (src: drizzle/0038_info_synthesis.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'synth_runs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON synth_runs;
    CREATE POLICY tenant_isolation ON synth_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE synth_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE synth_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0039_internal_software.sql
-- ----------------------------------------------------------------------------

-- internal_tool_runs.tenant_isolation  (src: drizzle/0039_internal_software.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'internal_tool_runs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON internal_tool_runs;
    CREATE POLICY tenant_isolation ON internal_tool_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE internal_tool_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_tool_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- internal_tools.tenant_isolation  (src: drizzle/0039_internal_software.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'internal_tools') THEN
    DROP POLICY IF EXISTS tenant_isolation ON internal_tools;
    CREATE POLICY tenant_isolation ON internal_tools
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE internal_tools ENABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_tools FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0040_reasoning_traces.sql
-- ----------------------------------------------------------------------------

-- mcts_search_tree_dumps.tenant_isolation  (src: drizzle/0040_reasoning_traces.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'mcts_search_tree_dumps') THEN
    DROP POLICY IF EXISTS tenant_isolation ON mcts_search_tree_dumps;
    CREATE POLICY tenant_isolation ON mcts_search_tree_dumps
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE mcts_search_tree_dumps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mcts_search_tree_dumps FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- prm_training_examples.tenant_isolation  (src: drizzle/0040_reasoning_traces.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'prm_training_examples') THEN
    DROP POLICY IF EXISTS tenant_isolation ON prm_training_examples;
    CREATE POLICY tenant_isolation ON prm_training_examples
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE prm_training_examples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prm_training_examples FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- reasoning_traces.tenant_isolation  (src: drizzle/0040_reasoning_traces.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'reasoning_traces') THEN
    DROP POLICY IF EXISTS tenant_isolation ON reasoning_traces;
    CREATE POLICY tenant_isolation ON reasoning_traces
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE reasoning_traces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reasoning_traces FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0041_graph_rag.sql
-- ----------------------------------------------------------------------------

-- kg_communities.kg_communities_tenant_isolation  (src: drizzle/0041_graph_rag.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'kg_communities') THEN
    DROP POLICY IF EXISTS kg_communities_tenant_isolation ON kg_communities;
    CREATE POLICY kg_communities_tenant_isolation ON kg_communities
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE kg_communities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kg_communities FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- kg_community_summaries.kg_summaries_tenant_isolation  (src: drizzle/0041_graph_rag.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'kg_community_summaries') THEN
    DROP POLICY IF EXISTS kg_summaries_tenant_isolation ON kg_community_summaries;
    CREATE POLICY kg_summaries_tenant_isolation ON kg_community_summaries
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE kg_community_summaries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kg_community_summaries FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- knowledge_graph_entities.kg_entities_tenant_isolation  (src: drizzle/0041_graph_rag.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'knowledge_graph_entities') THEN
    DROP POLICY IF EXISTS kg_entities_tenant_isolation ON knowledge_graph_entities;
    CREATE POLICY kg_entities_tenant_isolation ON knowledge_graph_entities
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE knowledge_graph_entities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE knowledge_graph_entities FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- knowledge_graph_relations.kg_relations_tenant_isolation  (src: drizzle/0041_graph_rag.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'knowledge_graph_relations') THEN
    DROP POLICY IF EXISTS kg_relations_tenant_isolation ON knowledge_graph_relations;
    CREATE POLICY kg_relations_tenant_isolation ON knowledge_graph_relations
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE knowledge_graph_relations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE knowledge_graph_relations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0042_omni_p0_batch1.sql
-- ----------------------------------------------------------------------------

-- calendar_events.calendar_events_tenant_rls  (src: drizzle/0042_omni_p0_batch1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'calendar_events') THEN
    DROP POLICY IF EXISTS calendar_events_tenant_rls ON calendar_events;
    CREATE POLICY calendar_events_tenant_rls
      ON calendar_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- connector_credentials.connector_credentials_tenant_rls  (src: drizzle/0042_omni_p0_batch1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'connector_credentials') THEN
    DROP POLICY IF EXISTS connector_credentials_tenant_rls ON connector_credentials;
    CREATE POLICY connector_credentials_tenant_rls
      ON connector_credentials
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
    ALTER TABLE connector_credentials FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- connector_cursors.connector_cursors_tenant_rls  (src: drizzle/0042_omni_p0_batch1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'connector_cursors') THEN
    DROP POLICY IF EXISTS connector_cursors_tenant_rls ON connector_cursors;
    CREATE POLICY connector_cursors_tenant_rls
      ON connector_cursors
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE connector_cursors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE connector_cursors FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- email_messages.email_messages_tenant_rls  (src: drizzle/0042_omni_p0_batch1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'email_messages') THEN
    DROP POLICY IF EXISTS email_messages_tenant_rls ON email_messages;
    CREATE POLICY email_messages_tenant_rls
      ON email_messages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- slack_messages.slack_messages_tenant_rls  (src: drizzle/0042_omni_p0_batch1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'slack_messages') THEN
    DROP POLICY IF EXISTS slack_messages_tenant_rls ON slack_messages;
    CREATE POLICY slack_messages_tenant_rls
      ON slack_messages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE slack_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0043_omni_p0_batch2.sql
-- ----------------------------------------------------------------------------

-- drive_files.drive_files_tenant_rls  (src: drizzle/0043_omni_p0_batch2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'drive_files') THEN
    DROP POLICY IF EXISTS drive_files_tenant_rls ON drive_files;
    CREATE POLICY drive_files_tenant_rls
      ON drive_files
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE drive_files FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- notion_blocks.notion_blocks_tenant_rls  (src: drizzle/0043_omni_p0_batch2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notion_blocks') THEN
    DROP POLICY IF EXISTS notion_blocks_tenant_rls ON notion_blocks;
    CREATE POLICY notion_blocks_tenant_rls
      ON notion_blocks
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE notion_blocks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notion_blocks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- notion_pages.notion_pages_tenant_rls  (src: drizzle/0043_omni_p0_batch2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notion_pages') THEN
    DROP POLICY IF EXISTS notion_pages_tenant_rls ON notion_pages;
    CREATE POLICY notion_pages_tenant_rls
      ON notion_pages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE notion_pages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notion_pages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- whatsapp_messages.whatsapp_messages_tenant_rls  (src: drizzle/0043_omni_p0_batch2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'whatsapp_messages') THEN
    DROP POLICY IF EXISTS whatsapp_messages_tenant_rls ON whatsapp_messages;
    CREATE POLICY whatsapp_messages_tenant_rls
      ON whatsapp_messages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0044_tacit_knowledge.sql
-- ----------------------------------------------------------------------------

-- tacit_consents.tc_tenant_isolation  (src: drizzle/0044_tacit_knowledge.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tacit_consents') THEN
    DROP POLICY IF EXISTS tc_tenant_isolation ON tacit_consents;
    CREATE POLICY tc_tenant_isolation ON tacit_consents
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tacit_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tacit_consents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tacit_extractions.te_tenant_isolation  (src: drizzle/0044_tacit_knowledge.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tacit_extractions') THEN
    DROP POLICY IF EXISTS te_tenant_isolation ON tacit_extractions;
    CREATE POLICY te_tenant_isolation ON tacit_extractions
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tacit_extractions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tacit_extractions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tacit_interviews.ti_tenant_isolation  (src: drizzle/0044_tacit_knowledge.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tacit_interviews') THEN
    DROP POLICY IF EXISTS ti_tenant_isolation ON tacit_interviews;
    CREATE POLICY ti_tenant_isolation ON tacit_interviews
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tacit_interviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tacit_interviews FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0045_capability_catalogue.sql
-- ----------------------------------------------------------------------------

-- capabilities.capabilities_tenant_isolation  (src: drizzle/0045_capability_catalogue.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capabilities') THEN
    DROP POLICY IF EXISTS capabilities_tenant_isolation ON capabilities;
    CREATE POLICY capabilities_tenant_isolation ON capabilities
      USING (
      tenant_id = current_setting('app.current_tenant_id', true)
      OR tenant_id = '__seed__'
      )
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE capabilities FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- capability_invocations.capability_invocations_tenant_isolation  (src: drizzle/0045_capability_catalogue.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capability_invocations') THEN
    DROP POLICY IF EXISTS capability_invocations_tenant_isolation ON capability_invocations;
    CREATE POLICY capability_invocations_tenant_isolation ON capability_invocations
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE capability_invocations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE capability_invocations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- capability_measurements.capability_measurements_tenant_isolation  (src: drizzle/0045_capability_catalogue.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capability_measurements') THEN
    DROP POLICY IF EXISTS capability_measurements_tenant_isolation ON capability_measurements;
    CREATE POLICY capability_measurements_tenant_isolation ON capability_measurements
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE capability_measurements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE capability_measurements FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- capability_outcomes.capability_outcomes_tenant_isolation  (src: drizzle/0045_capability_catalogue.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capability_outcomes') THEN
    DROP POLICY IF EXISTS capability_outcomes_tenant_isolation ON capability_outcomes;
    CREATE POLICY capability_outcomes_tenant_isolation ON capability_outcomes
      USING (
      EXISTS (
      SELECT 1
      FROM capability_invocations ci
      WHERE ci.id = capability_outcomes.invocation_id
      AND ci.tenant_id = current_setting('app.current_tenant_id', true)
      )
      )
      WITH CHECK (
      EXISTS (
      SELECT 1
      FROM capability_invocations ci
      WHERE ci.id = capability_outcomes.invocation_id
      AND ci.tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE capability_outcomes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE capability_outcomes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0046_omni_p1.sql
-- ----------------------------------------------------------------------------

-- github_records.github_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'github_records') THEN
    DROP POLICY IF EXISTS github_records_tenant_rls ON github_records;
    CREATE POLICY github_records_tenant_rls ON github_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE github_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE github_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- gitlab_records.gitlab_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'gitlab_records') THEN
    DROP POLICY IF EXISTS gitlab_records_tenant_rls ON gitlab_records;
    CREATE POLICY gitlab_records_tenant_rls ON gitlab_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE gitlab_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE gitlab_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- hubspot_records.hubspot_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'hubspot_records') THEN
    DROP POLICY IF EXISTS hubspot_records_tenant_rls ON hubspot_records;
    CREATE POLICY hubspot_records_tenant_rls ON hubspot_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE hubspot_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE hubspot_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- jira_records.jira_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'jira_records') THEN
    DROP POLICY IF EXISTS jira_records_tenant_rls ON jira_records;
    CREATE POLICY jira_records_tenant_rls ON jira_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE jira_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE jira_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- linear_records.linear_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'linear_records') THEN
    DROP POLICY IF EXISTS linear_records_tenant_rls ON linear_records;
    CREATE POLICY linear_records_tenant_rls ON linear_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE linear_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE linear_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- salesforce_records.salesforce_records_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'salesforce_records') THEN
    DROP POLICY IF EXISTS salesforce_records_tenant_rls ON salesforce_records;
    CREATE POLICY salesforce_records_tenant_rls ON salesforce_records
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE salesforce_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE salesforce_records FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- teams_messages.teams_messages_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'teams_messages') THEN
    DROP POLICY IF EXISTS teams_messages_tenant_rls ON teams_messages;
    CREATE POLICY teams_messages_tenant_rls ON teams_messages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE teams_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE teams_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- voice_calls.voice_calls_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'voice_calls') THEN
    DROP POLICY IF EXISTS voice_calls_tenant_rls ON voice_calls;
    CREATE POLICY voice_calls_tenant_rls ON voice_calls
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE voice_calls FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- zoom_meetings.zoom_meetings_tenant_rls  (src: drizzle/0046_omni_p1.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'zoom_meetings') THEN
    DROP POLICY IF EXISTS zoom_meetings_tenant_rls ON zoom_meetings;
    CREATE POLICY zoom_meetings_tenant_rls ON zoom_meetings
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE zoom_meetings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE zoom_meetings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0047_selfimprove_omni_p2.sql
-- ----------------------------------------------------------------------------

-- connector_credentials.connector_credentials_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'connector_credentials') THEN
    DROP POLICY IF EXISTS connector_credentials_tenant_isolation ON connector_credentials;
    CREATE POLICY connector_credentials_tenant_isolation ON connector_credentials
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
    ALTER TABLE connector_credentials FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- connector_cursors.connector_cursors_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'connector_cursors') THEN
    DROP POLICY IF EXISTS connector_cursors_tenant_isolation ON connector_cursors;
    CREATE POLICY connector_cursors_tenant_isolation ON connector_cursors
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE connector_cursors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE connector_cursors FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- dp_charges.dp_charges_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'dp_charges') THEN
    DROP POLICY IF EXISTS dp_charges_tenant_isolation ON dp_charges;
    CREATE POLICY dp_charges_tenant_isolation ON dp_charges
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE dp_charges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dp_charges FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- facebook_posts.facebook_posts_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'facebook_posts') THEN
    DROP POLICY IF EXISTS facebook_posts_tenant_isolation ON facebook_posts;
    CREATE POLICY facebook_posts_tenant_isolation ON facebook_posts
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE facebook_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE facebook_posts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- instagram_posts.instagram_posts_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'instagram_posts') THEN
    DROP POLICY IF EXISTS instagram_posts_tenant_isolation ON instagram_posts;
    CREATE POLICY instagram_posts_tenant_isolation ON instagram_posts
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE instagram_posts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- linkedin_posts.linkedin_posts_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'linkedin_posts') THEN
    DROP POLICY IF EXISTS linkedin_posts_tenant_isolation ON linkedin_posts;
    CREATE POLICY linkedin_posts_tenant_isolation ON linkedin_posts
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE linkedin_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE linkedin_posts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- meta_learning_examples.meta_learning_examples_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'meta_learning_examples') THEN
    DROP POLICY IF EXISTS meta_learning_examples_tenant_isolation ON meta_learning_examples;
    CREATE POLICY meta_learning_examples_tenant_isolation ON meta_learning_examples
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE meta_learning_examples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meta_learning_examples FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- meta_learning_runs.meta_learning_runs_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'meta_learning_runs') THEN
    DROP POLICY IF EXISTS meta_learning_runs_tenant_isolation ON meta_learning_runs;
    CREATE POLICY meta_learning_runs_tenant_isolation ON meta_learning_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE meta_learning_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meta_learning_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tiktok_posts.tiktok_posts_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tiktok_posts') THEN
    DROP POLICY IF EXISTS tiktok_posts_tenant_isolation ON tiktok_posts;
    CREATE POLICY tiktok_posts_tenant_isolation ON tiktok_posts
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tiktok_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tiktok_posts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- x_posts.x_posts_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'x_posts') THEN
    DROP POLICY IF EXISTS x_posts_tenant_isolation ON x_posts;
    CREATE POLICY x_posts_tenant_isolation ON x_posts
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE x_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE x_posts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- youtube_videos.youtube_videos_tenant_isolation  (src: drizzle/0047_selfimprove_omni_p2.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'youtube_videos') THEN
    DROP POLICY IF EXISTS youtube_videos_tenant_isolation ON youtube_videos;
    CREATE POLICY youtube_videos_tenant_isolation ON youtube_videos
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE youtube_videos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE youtube_videos FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0048_language_sota.sql
-- ----------------------------------------------------------------------------

-- language_provider_quality.language_provider_quality_tenant_isolation  (src: drizzle/0048_language_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_provider_quality') THEN
    DROP POLICY IF EXISTS language_provider_quality_tenant_isolation ON language_provider_quality;
    CREATE POLICY language_provider_quality_tenant_isolation ON language_provider_quality
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_provider_quality ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_provider_quality FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- language_user_profile.language_user_profile_tenant_isolation  (src: drizzle/0048_language_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_user_profile') THEN
    DROP POLICY IF EXISTS language_user_profile_tenant_isolation ON language_user_profile;
    CREATE POLICY language_user_profile_tenant_isolation ON language_user_profile
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_user_profile ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_user_profile FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- language_utterances.language_utterances_tenant_isolation  (src: drizzle/0048_language_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_utterances') THEN
    DROP POLICY IF EXISTS language_utterances_tenant_isolation ON language_utterances;
    CREATE POLICY language_utterances_tenant_isolation ON language_utterances
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_utterances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_utterances FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0049_swahili_linguistics.sql
-- ----------------------------------------------------------------------------

-- swahili_dialect_signals.swahili_dialect_signals_tenant_isolation  (src: drizzle/0049_swahili_linguistics.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'swahili_dialect_signals') THEN
    DROP POLICY IF EXISTS swahili_dialect_signals_tenant_isolation ON swahili_dialect_signals;
    CREATE POLICY swahili_dialect_signals_tenant_isolation ON swahili_dialect_signals
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE swahili_dialect_signals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE swahili_dialect_signals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- swahili_morphology_cache.swahili_morphology_cache_tenant_isolation  (src: drizzle/0049_swahili_linguistics.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'swahili_morphology_cache') THEN
    DROP POLICY IF EXISTS swahili_morphology_cache_tenant_isolation ON swahili_morphology_cache;
    CREATE POLICY swahili_morphology_cache_tenant_isolation ON swahili_morphology_cache
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE swahili_morphology_cache ENABLE ROW LEVEL SECURITY;
    ALTER TABLE swahili_morphology_cache FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- swahili_terms.swahili_terms_tenant_isolation  (src: drizzle/0049_swahili_linguistics.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'swahili_terms') THEN
    DROP POLICY IF EXISTS swahili_terms_tenant_isolation ON swahili_terms;
    CREATE POLICY swahili_terms_tenant_isolation ON swahili_terms
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE swahili_terms ENABLE ROW LEVEL SECURITY;
    ALTER TABLE swahili_terms FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0050_translation_sota.sql
-- ----------------------------------------------------------------------------

-- translation_evals.tenant_isolation  (src: drizzle/0050_translation_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'translation_evals') THEN
    DROP POLICY IF EXISTS tenant_isolation ON translation_evals;
    CREATE POLICY tenant_isolation ON translation_evals
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE translation_evals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE translation_evals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- translation_glossary_overrides.tenant_isolation  (src: drizzle/0050_translation_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'translation_glossary_overrides') THEN
    DROP POLICY IF EXISTS tenant_isolation ON translation_glossary_overrides;
    CREATE POLICY tenant_isolation ON translation_glossary_overrides
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE translation_glossary_overrides ENABLE ROW LEVEL SECURITY;
    ALTER TABLE translation_glossary_overrides FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- translation_runs.tenant_isolation  (src: drizzle/0050_translation_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'translation_runs') THEN
    DROP POLICY IF EXISTS tenant_isolation ON translation_runs;
    CREATE POLICY tenant_isolation ON translation_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE translation_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE translation_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0051_ambient_listening.sql
-- ----------------------------------------------------------------------------

-- ambient_captures.ambient_captures_tenant_isolation  (src: drizzle/0051_ambient_listening.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ambient_captures') THEN
    DROP POLICY IF EXISTS ambient_captures_tenant_isolation ON ambient_captures;
    CREATE POLICY ambient_captures_tenant_isolation ON ambient_captures
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ambient_captures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ambient_captures FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ambient_consents.ambient_consents_tenant_isolation  (src: drizzle/0051_ambient_listening.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ambient_consents') THEN
    DROP POLICY IF EXISTS ambient_consents_tenant_isolation ON ambient_consents;
    CREATE POLICY ambient_consents_tenant_isolation ON ambient_consents
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ambient_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ambient_consents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ambient_kill_switch_events.ambient_kse_tenant_isolation  (src: drizzle/0051_ambient_listening.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ambient_kill_switch_events') THEN
    DROP POLICY IF EXISTS ambient_kse_tenant_isolation ON ambient_kill_switch_events;
    CREATE POLICY ambient_kse_tenant_isolation ON ambient_kill_switch_events
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE ambient_kill_switch_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ambient_kill_switch_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0052_language_self_improve.sql
-- ----------------------------------------------------------------------------

-- language_adapters.language_adapters_tenant_read  (src: drizzle/0052_language_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_adapters') THEN
    DROP POLICY IF EXISTS language_adapters_tenant_read ON language_adapters;
    CREATE POLICY language_adapters_tenant_read ON language_adapters
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_adapters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_adapters FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- language_eval_runs.language_eval_runs_tenant_read  (src: drizzle/0052_language_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_eval_runs') THEN
    DROP POLICY IF EXISTS language_eval_runs_tenant_read ON language_eval_runs;
    CREATE POLICY language_eval_runs_tenant_read ON language_eval_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_eval_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_eval_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- language_gauntlet_entries.language_gauntlet_entries_tenant_read  (src: drizzle/0052_language_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_gauntlet_entries') THEN
    DROP POLICY IF EXISTS language_gauntlet_entries_tenant_read ON language_gauntlet_entries;
    CREATE POLICY language_gauntlet_entries_tenant_read ON language_gauntlet_entries
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_gauntlet_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_gauntlet_entries FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- language_training_pairs.language_training_pairs_tenant_read  (src: drizzle/0052_language_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'language_training_pairs') THEN
    DROP POLICY IF EXISTS language_training_pairs_tenant_read ON language_training_pairs;
    CREATE POLICY language_training_pairs_tenant_read ON language_training_pairs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE language_training_pairs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE language_training_pairs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0053_data_protection.sql
-- ----------------------------------------------------------------------------

-- breach_events.breach_events_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'breach_events') THEN
    DROP POLICY IF EXISTS breach_events_tenant_read ON breach_events;
    CREATE POLICY breach_events_tenant_read ON breach_events
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE breach_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE breach_events FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- data_classifications.data_classifications_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'data_classifications') THEN
    DROP POLICY IF EXISTS data_classifications_tenant_read ON data_classifications;
    CREATE POLICY data_classifications_tenant_read ON data_classifications
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE data_classifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE data_classifications FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- encryption_keys.encryption_keys_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'encryption_keys') THEN
    DROP POLICY IF EXISTS encryption_keys_tenant_read ON encryption_keys;
    CREATE POLICY encryption_keys_tenant_read ON encryption_keys
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE encryption_keys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE encryption_keys FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- retention_policies.retention_policies_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'retention_policies') THEN
    DROP POLICY IF EXISTS retention_policies_tenant_read ON retention_policies;
    CREATE POLICY retention_policies_tenant_read ON retention_policies
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- rtbf_cascades.rtbf_cascades_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rtbf_cascades') THEN
    DROP POLICY IF EXISTS rtbf_cascades_tenant_read ON rtbf_cascades;
    CREATE POLICY rtbf_cascades_tenant_read ON rtbf_cascades
      USING (
      EXISTS (
      SELECT 1 FROM rtbf_requests r
      WHERE r.id = rtbf_cascades.rtbf_request_id
      AND r.tenant_id = current_setting('app.current_tenant_id', true)
      )
      );
    ALTER TABLE rtbf_cascades ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rtbf_cascades FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- rtbf_requests.rtbf_requests_tenant_read  (src: drizzle/0053_data_protection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rtbf_requests') THEN
    DROP POLICY IF EXISTS rtbf_requests_tenant_read ON rtbf_requests;
    CREATE POLICY rtbf_requests_tenant_read ON rtbf_requests
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE rtbf_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rtbf_requests FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0054_agent_security.sql
-- ----------------------------------------------------------------------------

-- agent_security_signals.agent_security_signals_tenant_read  (src: drizzle/0054_agent_security.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'agent_security_signals') THEN
    DROP POLICY IF EXISTS agent_security_signals_tenant_read ON agent_security_signals;
    CREATE POLICY agent_security_signals_tenant_read ON agent_security_signals
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE agent_security_signals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_security_signals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- output_filter_blocks.output_filter_blocks_tenant_read  (src: drizzle/0054_agent_security.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'output_filter_blocks') THEN
    DROP POLICY IF EXISTS output_filter_blocks_tenant_read ON output_filter_blocks;
    CREATE POLICY output_filter_blocks_tenant_read ON output_filter_blocks
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE output_filter_blocks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE output_filter_blocks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- prompt_injection_attempts.prompt_injection_attempts_tenant_read  (src: drizzle/0054_agent_security.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'prompt_injection_attempts') THEN
    DROP POLICY IF EXISTS prompt_injection_attempts_tenant_read ON prompt_injection_attempts;
    CREATE POLICY prompt_injection_attempts_tenant_read ON prompt_injection_attempts
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE prompt_injection_attempts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prompt_injection_attempts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- red_team_runs.red_team_runs_tenant_read  (src: drizzle/0054_agent_security.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'red_team_runs') THEN
    DROP POLICY IF EXISTS red_team_runs_tenant_read ON red_team_runs;
    CREATE POLICY red_team_runs_tenant_read ON red_team_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE red_team_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE red_team_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- tool_use_violations.tool_use_violations_tenant_read  (src: drizzle/0054_agent_security.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tool_use_violations') THEN
    DROP POLICY IF EXISTS tool_use_violations_tenant_read ON tool_use_violations;
    CREATE POLICY tool_use_violations_tenant_read ON tool_use_violations
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE tool_use_violations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tool_use_violations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0058_employee_perf_followup.sql
-- ----------------------------------------------------------------------------

-- employee_scorecards.employee_scorecards_tenant_isolation  (src: drizzle/0058_employee_perf_followup.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'employee_scorecards') THEN
    DROP POLICY IF EXISTS employee_scorecards_tenant_isolation ON employee_scorecards;
    CREATE POLICY employee_scorecards_tenant_isolation ON employee_scorecards
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE employee_scorecards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE employee_scorecards FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- kpi_templates.kpi_templates_tenant_isolation_write  (src: drizzle/0058_employee_perf_followup.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'kpi_templates') THEN
    DROP POLICY IF EXISTS kpi_templates_tenant_isolation_write ON kpi_templates;
    CREATE POLICY kpi_templates_tenant_isolation_write ON kpi_templates
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE kpi_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kpi_templates FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- kpi_templates.kpi_templates_tenant_or_seed_read  (src: drizzle/0058_employee_perf_followup.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'kpi_templates') THEN
    DROP POLICY IF EXISTS kpi_templates_tenant_or_seed_read ON kpi_templates;
    CREATE POLICY kpi_templates_tenant_or_seed_read ON kpi_templates
      FOR SELECT
      USING (
      tenant_id = current_setting('app.current_tenant_id', true)
      OR tenant_id = '__seed__'
      );
    ALTER TABLE kpi_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kpi_templates FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- perf_nudges.perf_nudges_tenant_isolation  (src: drizzle/0058_employee_perf_followup.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'perf_nudges') THEN
    DROP POLICY IF EXISTS perf_nudges_tenant_isolation ON perf_nudges;
    CREATE POLICY perf_nudges_tenant_isolation ON perf_nudges
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE perf_nudges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE perf_nudges FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0060_swarm_coordination.sql
-- ----------------------------------------------------------------------------

-- active_agents.active_agents_tenant_read  (src: drizzle/0060_swarm_coordination.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'active_agents') THEN
    DROP POLICY IF EXISTS active_agents_tenant_read ON active_agents;
    CREATE POLICY active_agents_tenant_read ON active_agents
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE active_agents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE active_agents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- agent_messages.agent_messages_tenant_read  (src: drizzle/0060_swarm_coordination.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'agent_messages') THEN
    DROP POLICY IF EXISTS agent_messages_tenant_read ON agent_messages;
    CREATE POLICY agent_messages_tenant_read ON agent_messages
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_postings.blackboard_postings_tenant_read  (src: drizzle/0060_swarm_coordination.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_postings') THEN
    DROP POLICY IF EXISTS blackboard_postings_tenant_read ON blackboard_postings;
    CREATE POLICY blackboard_postings_tenant_read ON blackboard_postings
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_postings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_postings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- coordination_conflicts.coordination_conflicts_tenant_read  (src: drizzle/0060_swarm_coordination.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'coordination_conflicts') THEN
    DROP POLICY IF EXISTS coordination_conflicts_tenant_read ON coordination_conflicts;
    CREATE POLICY coordination_conflicts_tenant_read ON coordination_conflicts
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE coordination_conflicts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE coordination_conflicts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0061_work_cycle.sql
-- ----------------------------------------------------------------------------

-- work_cycle_journal.wcj_tenant_isolation  (src: drizzle/0061_work_cycle.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'work_cycle_journal') THEN
    DROP POLICY IF EXISTS wcj_tenant_isolation ON work_cycle_journal;
    CREATE POLICY wcj_tenant_isolation ON work_cycle_journal
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE work_cycle_journal ENABLE ROW LEVEL SECURITY;
    ALTER TABLE work_cycle_journal FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- work_cycle_state.wcs_tenant_isolation  (src: drizzle/0061_work_cycle.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'work_cycle_state') THEN
    DROP POLICY IF EXISTS wcs_tenant_isolation ON work_cycle_state;
    CREATE POLICY wcs_tenant_isolation ON work_cycle_state
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE work_cycle_state ENABLE ROW LEVEL SECURITY;
    ALTER TABLE work_cycle_state FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0062_voice_swahili.sql
-- ----------------------------------------------------------------------------

-- swahili_gauntlet_results.sgr_tenant_isolation  (src: drizzle/0062_voice_swahili.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'swahili_gauntlet_results') THEN
    DROP POLICY IF EXISTS sgr_tenant_isolation ON swahili_gauntlet_results;
    CREATE POLICY sgr_tenant_isolation ON swahili_gauntlet_results
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE swahili_gauntlet_results ENABLE ROW LEVEL SECURITY;
    ALTER TABLE swahili_gauntlet_results FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- voice_sessions.voice_sessions_tenant_isolation  (src: drizzle/0062_voice_swahili.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'voice_sessions') THEN
    DROP POLICY IF EXISTS voice_sessions_tenant_isolation ON voice_sessions;
    CREATE POLICY voice_sessions_tenant_isolation ON voice_sessions
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE voice_sessions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0063_org_legibility.sql
-- ----------------------------------------------------------------------------

-- legibility_deltas.legibility_deltas_tenant_read  (src: drizzle/0063_org_legibility.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'legibility_deltas') THEN
    DROP POLICY IF EXISTS legibility_deltas_tenant_read ON legibility_deltas;
    CREATE POLICY legibility_deltas_tenant_read ON legibility_deltas
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE legibility_deltas ENABLE ROW LEVEL SECURITY;
    ALTER TABLE legibility_deltas FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- legibility_snapshots.legibility_snapshots_tenant_read  (src: drizzle/0063_org_legibility.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'legibility_snapshots') THEN
    DROP POLICY IF EXISTS legibility_snapshots_tenant_read ON legibility_snapshots;
    CREATE POLICY legibility_snapshots_tenant_read ON legibility_snapshots
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE legibility_snapshots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE legibility_snapshots FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0064_strategic_layer.sql
-- ----------------------------------------------------------------------------

-- epsilon_budgets.eb_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'epsilon_budgets') THEN
    DROP POLICY IF EXISTS eb_tenant_isolation ON epsilon_budgets;
    CREATE POLICY eb_tenant_isolation ON epsilon_budgets
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE epsilon_budgets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE epsilon_budgets FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- epsilon_ledger.el_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'epsilon_ledger') THEN
    DROP POLICY IF EXISTS el_tenant_isolation ON epsilon_ledger;
    CREATE POLICY el_tenant_isolation ON epsilon_ledger
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE epsilon_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE epsilon_ledger FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- federation_consents.fc_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'federation_consents') THEN
    DROP POLICY IF EXISTS fc_tenant_isolation ON federation_consents;
    CREATE POLICY fc_tenant_isolation ON federation_consents
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE federation_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE federation_consents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- north_star_objectives.nso_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'north_star_objectives') THEN
    DROP POLICY IF EXISTS nso_tenant_isolation ON north_star_objectives;
    CREATE POLICY nso_tenant_isolation ON north_star_objectives
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE north_star_objectives ENABLE ROW LEVEL SECURITY;
    ALTER TABLE north_star_objectives FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- objective_progress.op_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'objective_progress') THEN
    DROP POLICY IF EXISTS op_tenant_isolation ON objective_progress;
    CREATE POLICY op_tenant_isolation ON objective_progress
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE objective_progress ENABLE ROW LEVEL SECURITY;
    ALTER TABLE objective_progress FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- pivot_proposals.pp_tenant_isolation  (src: drizzle/0064_strategic_layer.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pivot_proposals') THEN
    DROP POLICY IF EXISTS pp_tenant_isolation ON pivot_proposals;
    CREATE POLICY pp_tenant_isolation ON pivot_proposals
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE pivot_proposals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pivot_proposals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0065_rlvr.sql
-- ----------------------------------------------------------------------------

-- rlvr_curated_examples.rlvr_curated_tenant_read  (src: drizzle/0065_rlvr.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rlvr_curated_examples') THEN
    DROP POLICY IF EXISTS rlvr_curated_tenant_read ON rlvr_curated_examples;
    CREATE POLICY rlvr_curated_tenant_read ON rlvr_curated_examples
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE rlvr_curated_examples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rlvr_curated_examples FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- rlvr_runs.rlvr_runs_tenant_read  (src: drizzle/0065_rlvr.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rlvr_runs') THEN
    DROP POLICY IF EXISTS rlvr_runs_tenant_read ON rlvr_runs;
    CREATE POLICY rlvr_runs_tenant_read ON rlvr_runs
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE rlvr_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rlvr_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- rlvr_traces.rlvr_traces_tenant_read  (src: drizzle/0065_rlvr.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rlvr_traces') THEN
    DROP POLICY IF EXISTS rlvr_traces_tenant_read ON rlvr_traces;
    CREATE POLICY rlvr_traces_tenant_read ON rlvr_traces
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE rlvr_traces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rlvr_traces FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- rlvr_verifications.rlvr_verifications_tenant_read  (src: drizzle/0065_rlvr.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'rlvr_verifications') THEN
    DROP POLICY IF EXISTS rlvr_verifications_tenant_read ON rlvr_verifications;
    CREATE POLICY rlvr_verifications_tenant_read ON rlvr_verifications
      USING (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE rlvr_verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rlvr_verifications FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0066_dynamic_authored_recipes.sql
-- ----------------------------------------------------------------------------

-- dynamic_authored_recipes.dynamic_authored_recipes_tenant_isolation  (src: drizzle/0066_dynamic_authored_recipes.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'dynamic_authored_recipes') THEN
    DROP POLICY IF EXISTS dynamic_authored_recipes_tenant_isolation ON dynamic_authored_recipes;
    CREATE POLICY dynamic_authored_recipes_tenant_isolation
      ON dynamic_authored_recipes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE dynamic_authored_recipes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dynamic_authored_recipes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0067_forecast_runs.sql
-- ----------------------------------------------------------------------------

-- forecast_runs.forecast_runs_tenant_isolation  (src: drizzle/0067_forecast_runs.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'forecast_runs') THEN
    DROP POLICY IF EXISTS forecast_runs_tenant_isolation ON forecast_runs;
    CREATE POLICY forecast_runs_tenant_isolation
      ON forecast_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE forecast_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE forecast_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0068_graph_db_queries.sql
-- ----------------------------------------------------------------------------

-- graph_db_queries.graph_db_queries_tenant_isolation  (src: drizzle/0068_graph_db_queries.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'graph_db_queries') THEN
    DROP POLICY IF EXISTS graph_db_queries_tenant_isolation ON graph_db_queries;
    CREATE POLICY graph_db_queries_tenant_isolation
      ON graph_db_queries
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE graph_db_queries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE graph_db_queries FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0069_causal_inference.sql
-- ----------------------------------------------------------------------------

-- causal_runs.causal_runs_tenant_isolation  (src: drizzle/0069_causal_inference.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'causal_runs') THEN
    DROP POLICY IF EXISTS causal_runs_tenant_isolation ON causal_runs;
    CREATE POLICY causal_runs_tenant_isolation
      ON causal_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE causal_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE causal_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0070_anomaly_detection.sql
-- ----------------------------------------------------------------------------

-- anomaly_detections.anomaly_detections_tenant_isolation  (src: drizzle/0070_anomaly_detection.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'anomaly_detections') THEN
    DROP POLICY IF EXISTS anomaly_detections_tenant_isolation ON anomaly_detections;
    CREATE POLICY anomaly_detections_tenant_isolation
      ON anomaly_detections
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE anomaly_detections FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0072_intel_self_improve.sql
-- ----------------------------------------------------------------------------

-- intel_invocation_audit.intel_invocation_audit_tenant_isolation  (src: drizzle/0072_intel_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'intel_invocation_audit') THEN
    DROP POLICY IF EXISTS intel_invocation_audit_tenant_isolation ON intel_invocation_audit;
    CREATE POLICY intel_invocation_audit_tenant_isolation
      ON intel_invocation_audit
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE intel_invocation_audit ENABLE ROW LEVEL SECURITY;
    ALTER TABLE intel_invocation_audit FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- intel_skill_traces.intel_skill_traces_tenant_isolation  (src: drizzle/0072_intel_self_improve.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'intel_skill_traces') THEN
    DROP POLICY IF EXISTS intel_skill_traces_tenant_isolation ON intel_skill_traces;
    CREATE POLICY intel_skill_traces_tenant_isolation
      ON intel_skill_traces
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE intel_skill_traces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE intel_skill_traces FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0073_blackboard_sota.sql
-- ----------------------------------------------------------------------------

-- blackboard_cross_references.blackboard_xref_tenant_isolation  (src: drizzle/0073_blackboard_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_cross_references') THEN
    DROP POLICY IF EXISTS blackboard_xref_tenant_isolation ON blackboard_cross_references;
    CREATE POLICY blackboard_xref_tenant_isolation
      ON blackboard_cross_references
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_cross_references ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_cross_references FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_knowledge_sources.blackboard_ks_tenant_isolation  (src: drizzle/0073_blackboard_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_knowledge_sources') THEN
    DROP POLICY IF EXISTS blackboard_ks_tenant_isolation ON blackboard_knowledge_sources;
    CREATE POLICY blackboard_ks_tenant_isolation
      ON blackboard_knowledge_sources
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_knowledge_sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_knowledge_sources FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_posts_v2.blackboard_posts_v2_tenant_isolation  (src: drizzle/0073_blackboard_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_posts_v2') THEN
    DROP POLICY IF EXISTS blackboard_posts_v2_tenant_isolation ON blackboard_posts_v2;
    CREATE POLICY blackboard_posts_v2_tenant_isolation
      ON blackboard_posts_v2
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_posts_v2 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_posts_v2 FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_regions.blackboard_regions_tenant_isolation  (src: drizzle/0073_blackboard_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_regions') THEN
    DROP POLICY IF EXISTS blackboard_regions_tenant_isolation ON blackboard_regions;
    CREATE POLICY blackboard_regions_tenant_isolation
      ON blackboard_regions
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_regions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_regions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_summaries.blackboard_summaries_tenant_isolation  (src: drizzle/0073_blackboard_sota.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_summaries') THEN
    DROP POLICY IF EXISTS blackboard_summaries_tenant_isolation ON blackboard_summaries;
    CREATE POLICY blackboard_summaries_tenant_isolation
      ON blackboard_summaries
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_summaries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_summaries FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0074_blackboard_intel.sql
-- ----------------------------------------------------------------------------

-- blackboard_post_quality_scores.bpqs_tenant_isolation  (src: drizzle/0074_blackboard_intel.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_post_quality_scores') THEN
    DROP POLICY IF EXISTS bpqs_tenant_isolation ON blackboard_post_quality_scores;
    CREATE POLICY bpqs_tenant_isolation
      ON blackboard_post_quality_scores
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_post_quality_scores ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_post_quality_scores FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- blackboard_search_index.bsi_tenant_isolation  (src: drizzle/0074_blackboard_intel.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blackboard_search_index') THEN
    DROP POLICY IF EXISTS bsi_tenant_isolation ON blackboard_search_index;
    CREATE POLICY bsi_tenant_isolation
      ON blackboard_search_index
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE blackboard_search_index ENABLE ROW LEVEL SECURITY;
    ALTER TABLE blackboard_search_index FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- from drizzle/0076_cognitive_wiring_health.sql
-- ----------------------------------------------------------------------------

-- cognitive_wiring_health.cwh_tenant_isolation  (src: drizzle/0076_cognitive_wiring_health.sql · literal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cognitive_wiring_health') THEN
    DROP POLICY IF EXISTS cwh_tenant_isolation ON cognitive_wiring_health;
    CREATE POLICY cwh_tenant_isolation
      ON cognitive_wiring_health
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE cognitive_wiring_health ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cognitive_wiring_health FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role on every repointed table (Supabase-only; guarded for
-- vanilla Postgres / CI where the `anon` role does not exist).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH t IN ARRAY ARRAY[
    'active_agents',
    'advances',
    'agent_messages',
    'agent_security_signals',
    'agent_turns',
    'ambient_captures',
    'ambient_consents',
    'ambient_kill_switch_events',
    'anomaly_detections',
    'assets',
    'attendance',
    'authorities',
    'bank_accounts',
    'blackboard_cross_references',
    'blackboard_knowledge_sources',
    'blackboard_post_quality_scores',
    'blackboard_postings',
    'blackboard_posts_v2',
    'blackboard_regions',
    'blackboard_search_index',
    'blackboard_summaries',
    'breach_events',
    'buyers',
    'calendar_events',
    'calibration_observations',
    'calibration_weekly_reports',
    'capabilities',
    'capability_invocations',
    'capability_measurements',
    'capability_outcomes',
    'cash_balances',
    'causal_runs',
    'cognitive_memory_cells',
    'cognitive_memory_reinforcements',
    'cognitive_wiring_health',
    'companies',
    'connector_credentials',
    'connector_cursors',
    'continuous_watches',
    'coordination_conflicts',
    'costs',
    'csr_plans',
    'customer_district_assignments',
    'customer_locations',
    'data_classifications',
    'directors',
    'dp_charges',
    'drill_hole_layers',
    'drill_holes',
    'drive_files',
    'dynamic_authored_recipes',
    'email_messages',
    'employee_scorecards',
    'employees',
    'encryption_keys',
    'ephemeral_dashboard_telemetry',
    'epsilon_budgets',
    'epsilon_ledger',
    'equipment_maintenance_taxonomy',
    'executive_brief_actions',
    'facebook_posts',
    'federation_consents',
    'fingerprint_events',
    'followup_candidates',
    'followup_preferences',
    'forecast_runs',
    'forecasts',
    'fuel_logs',
    'github_records',
    'gitlab_records',
    'graph_db_queries',
    'grievances',
    'hubspot_records',
    'incidents',
    'instagram_posts',
    'intel_invocation_audit',
    'intel_skill_traces',
    'intelligence_corpus_chunks',
    'internal_tool_runs',
    'internal_tools',
    'jira_records',
    'junior_turn_feedback',
    'kg_communities',
    'kg_community_summaries',
    'knowledge_graph_entities',
    'knowledge_graph_relations',
    'kpi_templates',
    'language_adapters',
    'language_eval_runs',
    'language_gauntlet_entries',
    'language_provider_quality',
    'language_training_pairs',
    'language_user_profile',
    'language_utterances',
    'legibility_deltas',
    'legibility_snapshots',
    'licence_events',
    'licences',
    'linear_records',
    'linkedin_posts',
    'loop_layer_outcomes',
    'loop_quality_signals',
    'loop_runs',
    'maintenance_events',
    'marketplace_bids',
    'marketplace_listings',
    'mcp_external_connections',
    'mcp_tool_invocations',
    'mcts_search_tree_dumps',
    'meta_learning_examples',
    'meta_learning_runs',
    'mutation_approvals',
    'mutation_history',
    'mutation_proposals',
    'north_star_objectives',
    'notion_blocks',
    'notion_pages',
    'objective_progress',
    'offtake_queue',
    'ore_parcels',
    'org_unit_service_areas',
    'output_filter_blocks',
    'pending_threads',
    'perf_nudges',
    'persona_voice_mode',
    'pivot_proposals',
    'ppe_issues',
    'pre_shift_inspections',
    'prm_training_examples',
    'production_records',
    'prompt_injection_attempts',
    'ratings',
    'reasoning_traces',
    'red_team_runs',
    'research_artifacts',
    'research_plans',
    'research_results',
    'research_sessions',
    'research_steps',
    'retention_policies',
    'risks',
    'rlvr_curated_examples',
    'rlvr_runs',
    'rlvr_traces',
    'rlvr_verifications',
    'routing_rules',
    'rtbf_cascades',
    'rtbf_requests',
    'sae_probe_features',
    'sales',
    'salesforce_records',
    'samples',
    'second_authoriser_assignments',
    'session_memory',
    'session_scopes',
    'shareholders',
    'shift_reports',
    'site_sections',
    'site_supervisor_coverage',
    'sites',
    'skills',
    'slack_messages',
    'swahili_dialect_signals',
    'swahili_gauntlet_results',
    'swahili_morphology_cache',
    'swahili_terms',
    'synth_outputs',
    'synth_runs',
    'tab_events',
    'tab_sessions',
    'tacit_consents',
    'tacit_extractions',
    'tacit_interviews',
    'tasks',
    'teams_messages',
    'thread_summaries',
    'tiktok_posts',
    'tool_use_violations',
    'translation_evals',
    'translation_glossary_overrides',
    'translation_runs',
    'vein_models',
    'village_meetings',
    'voice_calls',
    'voice_sessions',
    'whatsapp_messages',
    'work_cycle_journal',
    'work_cycle_state',
    'worker_incentives',
    'x_posts',
    'youtube_videos',
    'zoom_meetings'
    ]
    LOOP
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = t) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
      END IF;
    END LOOP;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN
-- -----------------------------------------------------------------------------
-- Reverts to the drizzle/ baseline end state: every policy below repointed back
-- to the LEGACY `app.tenant_id` GUC and RLS demoted from FORCE to ENABLE-only
-- (the documented drizzle/0003..0076 baseline). The runner is forward-only, so
-- this block is kept COMMENTED; apply it manually with a BYPASSRLS connection
-- to roll back. Mirrors the 0157 / 0296 down convention (commented, in-file; no
-- separate down/ script and no _registry.json entry — the 0156 / 0157 / 0296
-- RLS-repoint precedents carry none).
--
-- For each (table, policy): re-create the policy reading
--   current_setting('app.tenant_id', true)
-- with the IDENTICAL shape emitted above, then:
--   ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
-- Example (advances):
--
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM information_schema.tables
--              WHERE table_schema='public' AND table_name='advances') THEN
--     DROP POLICY IF EXISTS tenant_isolation ON advances;
--     CREATE POLICY tenant_isolation ON advances
--       USING (tenant_id = current_setting('app.tenant_id', true));
--     ALTER TABLE advances NO FORCE ROW LEVEL SECURITY;
--   END IF;
-- END $$;
-- -- … repeat for the remaining 191 tables/policies …
-- COMMIT;
-- =============================================================================
