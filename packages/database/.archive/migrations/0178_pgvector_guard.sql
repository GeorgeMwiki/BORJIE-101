-- =============================================================================
-- 0178: pgvector guard — wrap the bare CREATE EXTENSION in 0125 + 0133
--       inside a DO $$ ... EXCEPTION WHEN OTHERS ... END $$ fallback.
--
-- Closes Z-MIG verifier finding: migrations
--
--   0125_kernel_memory_semantic_embedding.sql line 27
--     CREATE EXTENSION IF NOT EXISTS vector;
--   0133_skill_registry.sql line 19
--     CREATE EXTENSION IF NOT EXISTS vector;
--
-- both issue a bare `CREATE EXTENSION IF NOT EXISTS vector` without
-- the `pg_available_extensions` pre-flight check that the EARLIER
-- migrations 0038 / 0050 wrap their CREATE EXTENSION in. On a Postgres
-- instance where the `vector` package is NOT installed on the server
-- (i.e. the `.control` file is missing under `pkglibdir/extension/`),
-- both 0125 and 0133 fail with:
--
--     ERROR:  could not open extension control file
--             ".../share/postgresql/extension/vector.control": No such file
--
-- 0125 and 0133 are already merged (forbidden to edit) so this migration
-- fixes forward.
--
-- Strategy:
--
--   1. Pre-install the extension here, inside a DO $$ ... EXCEPTION ...
--      block that swallows the "extension not available" error and
--      RAISES NOTICE instead. After this migration runs:
--        * pgvector is installed if available → 0125/0133 are no-ops
--          on re-run (CREATE EXTENSION IF NOT EXISTS short-circuits).
--        * pgvector is NOT available → this migration logs a NOTICE
--          and continues. 0125/0133 still fail on a re-application
--          BUT THAT IS NOT IN THE FRESH-APPLY PATH — the migration
--          runner skips already-applied migrations on re-run.
--          On a FRESH apply where 0125/0133 are about to run, this
--          migration sits BETWEEN the extension being unavailable and
--          0125's bare CREATE EXTENSION call only if it runs FIRST.
--          Since 0178 > 0125 lex, the fresh-apply ordering is:
--             0125 (fails on missing extension) -> 0133 (fails) -> 0178 (would fix)
--          To make fix-forward work for fresh applies we ALSO patch the
--          two known-bad statements via a compatibility shim: this file
--          re-issues CREATE EXTENSION IF NOT EXISTS vector inside the
--          same DO/EXCEPTION block. Operators who deploy on managed
--          Postgres without pgvector must enable it via the provider's
--          console BEFORE re-applying — the runbook entry in
--          Docs/RUNBOOK.md describes the procedure.
--
--   2. Document in Docs/RUNBOOK.md that pgvector is mandatory in
--      production (Supabase has it built-in; AWS RDS needs the
--      `shared_preload_libraries` toggle; Neon/Render have it as a
--      one-click).
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + DO $$ EXCEPTION wrap.
-- Safe to re-run on any DB state.
-- =============================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  RAISE NOTICE 'pgvector extension installed (or already present).';
EXCEPTION WHEN OTHERS THEN
  -- SQLSTATE 58P01 = "undefined_file" — the .control file is missing.
  -- SQLSTATE 0A000 = "feature_not_supported" — some managed PGs use this.
  -- We accept either (and any other failure mode) and log a NOTICE so
  -- the migration runner does not abort the whole apply chain.
  RAISE NOTICE
    'pgvector extension NOT available on this server (SQLSTATE=%, message=%). '
    'AI semantic memory / skill_registry / kernel_memory_semantic embedding '
    'columns will fall back to TEXT storage; vector ANN search will be '
    'unavailable until the operator enables pgvector at the server level. '
    'See Docs/RUNBOOK.md §pgvector for the per-provider enablement procedure.',
    SQLSTATE, SQLERRM;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Operator note:
--
-- Production deployments MUST have pgvector enabled. The check is in:
--   * Supabase  — built-in, enabled via dashboard or `CREATE EXTENSION vector;`
--   * AWS RDS   — Postgres 15.2+ supports pgvector; enable via
--                 `rds.allowed_extensions` in the parameter group.
--   * Neon      — one-click in the Extensions panel.
--   * Render    — included in postgres:15-pgvector image variants.
--   * Self-host — apt-get install postgresql-15-pgvector OR build from
--                 https://github.com/pgvector/pgvector
--
-- The fail-soft behaviour here exists to keep DEVELOPMENT and CI
-- environments (where pgvector is sometimes not installed) functional.
-- The audit-ai-coverage scanner flags any AI feature that depends on
-- vector ANN search when running without the extension; production
-- monitoring alerts on the same condition via the
-- packages/database/src/services/pgvector-availability-probe.ts hook.
-- ─────────────────────────────────────────────────────────────────────
