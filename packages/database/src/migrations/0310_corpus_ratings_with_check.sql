-- =============================================================================
-- Migration 0310 — close the cross-tenant data-poisoning RLS hole on
-- `intelligence_corpus_chunks` and `ratings`.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Both tables carried a single permissive policy `tenant_or_global`:
--
--     USING (tenant_id IS NULL
--            OR tenant_id = current_setting('app.current_tenant_id', true))
--
-- defined in drizzle/0003_mining_domain.sql:1107 and re-pointed onto the
-- canonical GUC in src/migrations/0297_rls_repoint_legacy_tenant_guc_drizzle.sql.
-- It has NO `WITH CHECK`. Under FORCE ROW LEVEL SECURITY, Postgres falls back to
-- the `USING` expression for the write-side check when `WITH CHECK` is absent.
-- Because `tenant_id IS NULL` makes the USING predicate TRUE, ANY tenant-scoped
-- session could INSERT (or UPDATE-to) a row with `tenant_id = NULL` — writing
-- into the GLOBAL, every-tenant-readable ground-truth corpus. That is a direct
-- violation of the "cross-tenant corpus tenant_id=NULL ground-truth safety"
-- hard rule: one malicious tenant could poison the knowledge every other tenant
-- reads (and the global `ratings` pool).
--
-- The legitimate writer of global (`tenant_id = NULL`) rows is the first-boot
-- corpus-ingest worker
-- (services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts via the
-- Drizzle sink in borjie-corpus-adapters.ts). It connects through the
-- api-gateway `getDb()` singleton, whose `DATABASE_URL` in production is the
-- Supabase `service_role` connection — a BYPASSRLS role. RLS policies do NOT
-- apply to a BYPASSRLS role, so adding `WITH CHECK` here CANNOT break the
-- global ingest. (Verified in with-worker-tenant-context.ts, whose own comment
-- documents that the worker connects via the Supabase `service_role`/BYPASSRLS.)
--
-- THE FIX
-- -------
-- Replace the single read+write `tenant_or_global` policy on each table with:
--
--   1. A SELECT policy `*_read_tenant_or_global` — UNCHANGED read semantics:
--        USING (tenant_id IS NULL OR tenant_id = <GUC>)
--      so every tenant still inherits the global corpus / global ratings.
--
--   2. An INSERT policy `*_insert_own_tenant` — write-only own rows:
--        WITH CHECK (tenant_id IS NOT NULL AND tenant_id = <GUC>)
--      a tenant session can NEVER insert a NULL (global) row.
--
--   3. An UPDATE policy `*_update_own_tenant`:
--        USING      (tenant_id = <GUC>)            -- only your own rows are visible to update
--        WITH CHECK (tenant_id IS NOT NULL AND tenant_id = <GUC>)  -- cannot flip a row to NULL/other tenant
--
--   4. A service-role bypass `*_service_role_bypass` (FOR ALL) mirroring the
--      0308/0309 shape, keyed on the `app.is_service_role` GUC, so a future
--      ingest path that runs under `withServiceRoleContext` (non-BYPASSRLS
--      role) can still write global rows. Harmless under the current BYPASSRLS
--      ingest; present for robustness + defense-in-depth.
--
-- There is NO DELETE policy: under FORCE RLS with no DELETE policy, a
-- tenant-scoped session cannot delete any row of these tables (only the
-- service-role bypass FOR ALL, or a BYPASSRLS role, may). That is the safe
-- direction for global ground truth.
--
-- NOTE on the OTHER policy the audit flagged: a separate `auth_tenant_isolation`
-- policy was investigated and DOES NOT EXIST anywhere in this repository
-- (grep across src/migrations + drizzle returns nothing). The only policy on
-- either table is `tenant_or_global`. The archived RLS sweeps
-- (packages/database/.archive/migrations/*) use the names
-- `tenant_isolation_select` / `tenant_isolation_modify` and do not target these
-- two tables, and `.archive/` is not on the apply path. So there is no second
-- permissive policy that could OR-in a tenant-writes-NULL path; replacing
-- `tenant_or_global` fully closes the hole.
--
-- Canonical GUC only (`app.current_tenant_id`). Idempotent: every CREATE POLICY
-- is guarded by a `pg_policies` existence check, every DROP uses IF EXISTS, and
-- ENABLE/FORCE ROW LEVEL SECURITY are re-asserted. Re-runnable without error.
-- Migrations are immutable: this is a NEW forward file (0307/0308/0309 exist).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- intelligence_corpus_chunks
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'intelligence_corpus_chunks'
  ) THEN
    -- Keep RLS enabled + FORCEd (FORCE applies RLS even to the table owner).
    EXECUTE 'ALTER TABLE intelligence_corpus_chunks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE intelligence_corpus_chunks FORCE  ROW LEVEL SECURITY';

    -- Drop the holey read+write policy (no WITH CHECK → write fell back to USING).
    EXECUTE 'DROP POLICY IF EXISTS tenant_or_global ON intelligence_corpus_chunks';

    -- (1) READ — unchanged: tenant sees its own rows + global (NULL) rows.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'intelligence_corpus_chunks'
         AND policyname = 'intelligence_corpus_chunks_read_tenant_or_global'
    ) THEN
      EXECUTE $p$
        CREATE POLICY intelligence_corpus_chunks_read_tenant_or_global
          ON intelligence_corpus_chunks
          FOR SELECT
          USING (
            tenant_id IS NULL
            OR tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (2) INSERT — own rows only; NULL (global) writes are rejected.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'intelligence_corpus_chunks'
         AND policyname = 'intelligence_corpus_chunks_insert_own_tenant'
    ) THEN
      EXECUTE $p$
        CREATE POLICY intelligence_corpus_chunks_insert_own_tenant
          ON intelligence_corpus_chunks
          FOR INSERT
          WITH CHECK (
            tenant_id IS NOT NULL
            AND tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (3) UPDATE — only your own rows, and you cannot flip tenant_id to
    --     NULL/another tenant.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'intelligence_corpus_chunks'
         AND policyname = 'intelligence_corpus_chunks_update_own_tenant'
    ) THEN
      EXECUTE $p$
        CREATE POLICY intelligence_corpus_chunks_update_own_tenant
          ON intelligence_corpus_chunks
          FOR UPDATE
          USING (
            tenant_id = current_setting('app.current_tenant_id', true)
          )
          WITH CHECK (
            tenant_id IS NOT NULL
            AND tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (4) SERVICE-ROLE BYPASS — global ingest path (withServiceRoleContext).
    --     Harmless under the current BYPASSRLS ingest; defense-in-depth so a
    --     non-BYPASSRLS service path can still write global (NULL) rows.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'intelligence_corpus_chunks'
         AND policyname = 'intelligence_corpus_chunks_service_role_bypass'
    ) THEN
      EXECUTE $p$
        CREATE POLICY intelligence_corpus_chunks_service_role_bypass
          ON intelligence_corpus_chunks
          FOR ALL
          USING (current_setting('app.is_service_role', true) = 'true')
          WITH CHECK (current_setting('app.is_service_role', true) = 'true')
      $p$;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ratings
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'ratings'
  ) THEN
    EXECUTE 'ALTER TABLE ratings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE ratings FORCE  ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS tenant_or_global ON ratings';

    -- (1) READ — unchanged: own rows + global (NULL) rows.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'ratings'
         AND policyname = 'ratings_read_tenant_or_global'
    ) THEN
      EXECUTE $p$
        CREATE POLICY ratings_read_tenant_or_global
          ON ratings
          FOR SELECT
          USING (
            tenant_id IS NULL
            OR tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (2) INSERT — own rows only; NULL (global) writes are rejected.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'ratings'
         AND policyname = 'ratings_insert_own_tenant'
    ) THEN
      EXECUTE $p$
        CREATE POLICY ratings_insert_own_tenant
          ON ratings
          FOR INSERT
          WITH CHECK (
            tenant_id IS NOT NULL
            AND tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (3) UPDATE — own rows only; cannot flip tenant_id to NULL/other tenant.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'ratings'
         AND policyname = 'ratings_update_own_tenant'
    ) THEN
      EXECUTE $p$
        CREATE POLICY ratings_update_own_tenant
          ON ratings
          FOR UPDATE
          USING (
            tenant_id = current_setting('app.current_tenant_id', true)
          )
          WITH CHECK (
            tenant_id IS NOT NULL
            AND tenant_id = current_setting('app.current_tenant_id', true)
          )
      $p$;
    END IF;

    -- (4) SERVICE-ROLE BYPASS — system/global writes (withServiceRoleContext).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'ratings'
         AND policyname = 'ratings_service_role_bypass'
    ) THEN
      EXECUTE $p$
        CREATE POLICY ratings_service_role_bypass
          ON ratings
          FOR ALL
          USING (current_setting('app.is_service_role', true) = 'true')
          WITH CHECK (current_setting('app.is_service_role', true) = 'true')
      $p$;
    END IF;
  END IF;
END $$;

COMMIT;
