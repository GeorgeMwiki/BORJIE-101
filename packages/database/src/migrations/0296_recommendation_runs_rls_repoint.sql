-- =============================================================================
-- Migration 0296 — recommendation_runs / recommendation_feedback RLS repoint
-- + FORCE ROW LEVEL SECURITY (wiring @borjie/recommendations into live use).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The `@borjie/recommendations` package (buyer↔mine / worker↔site /
-- supplier↔mine matching, persona Mr. Mwikila) persists every ranking into
-- `recommendation_runs` + `recommendation_feedback`. Those tables were created
-- by `packages/database/drizzle/0071_recommendation_runs.sql`, but 0071
-- predates the GUC-unification waves (0150 / 0156 / 0157) and shipped with a
-- LATENT RLS BUG identical to the failure mode those migrations fixed for
-- other tables:
--
--   * 0071 created the tenant-isolation policies reading the LEGACY
--     `current_setting('app.tenant_id', true)` GUC.
--   * api-gateway's `databaseMiddleware`
--     (services/api-gateway/src/middleware/database.ts) only ever binds the
--     CANONICAL `app.current_tenant_id` GUC on the request connection.
--   * Result: under an authenticated request connection the predicate
--     evaluates `NULL = tenant_id` -> NULL, which Postgres treats as FALSE
--     under RLS, so EVERY read AND write silently affects ZERO rows. The bug
--     stayed hidden only because the Supabase `service_role` connection has
--     BYPASSRLS, so out-of-band tooling never tripped it. The new gateway
--     recommendations route runs on the request connection, so it WOULD hit
--     the zero-rows wall without this repoint.
--
--   * 0071 also only `ENABLE`d RLS (never `FORCE`d it). Per the CLAUDE.md hard
--     rule ("RLS is FORCE-enabled on every tenant-scoped table") we promote
--     both tables to FORCE so even the table owner is subject to the policy.
--
-- WHAT THIS MIGRATION DOES (idempotent, forward-only)
--   1. Repoints `recommendation_runs_tenant_isolation` onto
--      `app.current_tenant_id` (tenant_id is TEXT -> bare compare, matching
--      the 0071 column type and the 0157 cast convention).
--   2. Repoints `recommendation_feedback_tenant_isolation` (EXISTS-subquery
--      against the parent run) onto `app.current_tenant_id`.
--   3. FORCE ROW LEVEL SECURITY on both tables.
--
-- The policy NAMES, target tables, `FOR ALL`, and USING/WITH CHECK SHAPE are
-- reproduced byte-for-byte from 0071 with the GUC name as the only change, so
-- replaying 0071 followed by 0296 lands the correct end state (the exact
-- discipline 0157 follows).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md: migrations are immutable +
-- forward-only). Every block is guarded by an information_schema.tables
-- existence check + DROP POLICY IF EXISTS, so it is safe to apply on a shard
-- where 0071 has not run and safe to re-run. No table data is touched.
--
-- Companion files:
--   * packages/recommendations/ (the engine + SQL repository)
--   * services/api-gateway/src/routes/mining/recommendations.hono.ts (route)
-- =============================================================================

BEGIN;

-- ---- recommendation_runs : tenant_id (text) ---------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'recommendation_runs'
  ) THEN
    DROP POLICY IF EXISTS recommendation_runs_tenant_isolation
      ON recommendation_runs;
    CREATE POLICY recommendation_runs_tenant_isolation
      ON recommendation_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
    ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE recommendation_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ---- recommendation_feedback : parent-run EXISTS subquery --------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'recommendation_feedback'
  ) THEN
    DROP POLICY IF EXISTS recommendation_feedback_tenant_isolation
      ON recommendation_feedback;
    CREATE POLICY recommendation_feedback_tenant_isolation
      ON recommendation_feedback
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
            FROM recommendation_runs r
           WHERE r.id = recommendation_feedback.run_id
             AND r.tenant_id = current_setting('app.current_tenant_id', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
            FROM recommendation_runs r
           WHERE r.id = recommendation_feedback.run_id
             AND r.tenant_id = current_setting('app.current_tenant_id', true)
        )
      );
    ALTER TABLE recommendation_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE recommendation_feedback FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='recommendation_runs') THEN
      EXECUTE 'REVOKE ALL ON public.recommendation_runs FROM anon;';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='recommendation_feedback') THEN
      EXECUTE 'REVOKE ALL ON public.recommendation_feedback FROM anon;';
    END IF;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN
-- -----------------------------------------------------------------------------
-- Reverts to the 0071 end state: policies repointed back to the LEGACY
-- `app.tenant_id` GUC and RLS demoted from FORCE to ENABLE-only. This restores
-- the exact pre-0296 shape (which is the documented 0071 baseline). The runner
-- is forward-only, so this block is kept commented; apply it manually with a
-- BYPASSRLS connection to roll back.
--
-- BEGIN;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM information_schema.tables
--              WHERE table_schema='public' AND table_name='recommendation_runs') THEN
--     ALTER TABLE recommendation_runs NO FORCE ROW LEVEL SECURITY;
--     DROP POLICY IF EXISTS recommendation_runs_tenant_isolation ON recommendation_runs;
--     CREATE POLICY recommendation_runs_tenant_isolation
--       ON recommendation_runs
--       FOR ALL
--       USING (tenant_id = current_setting('app.tenant_id', true))
--       WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--   END IF;
-- END $$;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM information_schema.tables
--              WHERE table_schema='public' AND table_name='recommendation_feedback') THEN
--     ALTER TABLE recommendation_feedback NO FORCE ROW LEVEL SECURITY;
--     DROP POLICY IF EXISTS recommendation_feedback_tenant_isolation ON recommendation_feedback;
--     CREATE POLICY recommendation_feedback_tenant_isolation
--       ON recommendation_feedback
--       FOR ALL
--       USING (
--         EXISTS (SELECT 1 FROM recommendation_runs r
--                  WHERE r.id = recommendation_feedback.run_id
--                    AND r.tenant_id = current_setting('app.tenant_id', true))
--       )
--       WITH CHECK (
--         EXISTS (SELECT 1 FROM recommendation_runs r
--                  WHERE r.id = recommendation_feedback.run_id
--                    AND r.tenant_id = current_setting('app.tenant_id', true))
--       );
--   END IF;
-- END $$;
--
-- COMMIT;
-- =============================================================================
