-- =============================================================================
-- Down-migration 0310 — reverse the corpus/ratings WITH CHECK hardening.
--
-- Dev/staging only. Restores the ORIGINAL single permissive `tenant_or_global`
-- policy on both tables (read+write, no WITH CHECK) exactly as
-- 0297_rls_repoint_legacy_tenant_guc_drizzle.sql left it. WARNING: doing so
-- REOPENS the cross-tenant data-poisoning hole (a tenant session can write
-- tenant_id=NULL global rows). Only run this to roll back the fix in a
-- non-production environment.
--
-- No data is lost (policy-only change). Reverses
-- 0310_corpus_ratings_with_check.sql.
-- =============================================================================

BEGIN;

-- intelligence_corpus_chunks — drop the split policies, restore tenant_or_global.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'intelligence_corpus_chunks'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS intelligence_corpus_chunks_service_role_bypass ON intelligence_corpus_chunks';
    EXECUTE 'DROP POLICY IF EXISTS intelligence_corpus_chunks_update_own_tenant   ON intelligence_corpus_chunks';
    EXECUTE 'DROP POLICY IF EXISTS intelligence_corpus_chunks_insert_own_tenant   ON intelligence_corpus_chunks';
    EXECUTE 'DROP POLICY IF EXISTS intelligence_corpus_chunks_read_tenant_or_global ON intelligence_corpus_chunks';
    EXECUTE 'DROP POLICY IF EXISTS tenant_or_global ON intelligence_corpus_chunks';
    EXECUTE $p$
      CREATE POLICY tenant_or_global
        ON intelligence_corpus_chunks
        USING (
          tenant_id IS NULL
          OR tenant_id = current_setting('app.current_tenant_id', true)
        )
    $p$;
  END IF;
END $$;

-- ratings — drop the split policies, restore tenant_or_global.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'ratings'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS ratings_service_role_bypass ON ratings';
    EXECUTE 'DROP POLICY IF EXISTS ratings_update_own_tenant   ON ratings';
    EXECUTE 'DROP POLICY IF EXISTS ratings_insert_own_tenant   ON ratings';
    EXECUTE 'DROP POLICY IF EXISTS ratings_read_tenant_or_global ON ratings';
    EXECUTE 'DROP POLICY IF EXISTS tenant_or_global ON ratings';
    EXECUTE $p$
      CREATE POLICY tenant_or_global
        ON ratings
        USING (
          tenant_id IS NULL
          OR tenant_id = current_setting('app.current_tenant_id', true)
        )
    $p$;
  END IF;
END $$;

COMMIT;
