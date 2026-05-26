-- =============================================================================
-- 0184: reflexion_buffer extension + reflexion_guidelines table.
--
-- LITFIN Reflexion runtime port. Layered on top of the original
-- 0134_reflexion_buffer.sql which created the bare buffer without RLS
-- or the columns the 4-pass nightly sleep consolidation needs.
--
-- This migration:
--   1. Adds `importance`, `task_id`, `pruned_at`, `cluster_id` columns
--      to the existing `reflexion_buffer` table (idempotent ADD IF NOT
--      EXISTS pattern).
--   2. Adds a `reflexion_active_per_user` index for the loader filter
--      `pruned_at IS NULL`.
--   3. Creates a sibling `reflexion_guidelines` table for pass-3
--      (update-guidelines).
--   4. Installs the GOLD-STANDARD RLS pattern matching
--      0182_section_layouts.sql:
--        * ENABLE + FORCE ROW LEVEL SECURITY
--        * tenant_isolation_select policy (USING)
--        * tenant_isolation_modify policy (FOR ALL, USING + WITH CHECK)
--        * REVOKE ALL FROM anon
--      Both tables route through `public.current_app_tenant_id()` (the
--      canonical GUC helper installed by 0172).
--
-- Idempotent: every operation gated on column/index/policy existence,
-- safe to re-run on a fresh database.
--
-- Array variable name (`tenant_tables`) matches the
-- audit-rls-coverage scanner expectation so the loop-installed
-- policies are picked up by CI.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Extend reflexion_buffer with consolidation-pass columns.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE reflexion_buffer
  ADD COLUMN IF NOT EXISTS task_id     TEXT;

ALTER TABLE reflexion_buffer
  ADD COLUMN IF NOT EXISTS importance  REAL NOT NULL DEFAULT 0.5;

ALTER TABLE reflexion_buffer
  ADD COLUMN IF NOT EXISTS pruned_at   TIMESTAMPTZ;

ALTER TABLE reflexion_buffer
  ADD COLUMN IF NOT EXISTS cluster_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_reflexion_active_per_user
  ON reflexion_buffer (tenant_id, user_id, pruned_at, recorded_at DESC);

COMMENT ON COLUMN reflexion_buffer.importance IS
  '0..1 caller-supplied importance. Pass-4 (prune-stale) uses it as a multiplier on the age-out window.';
COMMENT ON COLUMN reflexion_buffer.pruned_at IS
  'Soft-prune timestamp. Loader filters pruned_at IS NULL.';
COMMENT ON COLUMN reflexion_buffer.cluster_id IS
  'Pass-1 (dedupe-cluster) writes the representative reflexion id here on each duplicate.';
COMMENT ON COLUMN reflexion_buffer.task_id IS
  'Optional caller-provided task handle for cron/agent pipelines lacking a session_id.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Create reflexion_guidelines (pass-3 output).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reflexion_guidelines (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** NULL = tenant-wide guideline. */
  user_id              TEXT,
  /** Stable identifier for dedupe: lowercased "when-X-then-Y" key. */
  slug                 TEXT NOT NULL,
  /** Phrased guideline body, max ~600 chars by the pass writer. */
  body                 TEXT NOT NULL,
  /** 0..1 confidence the auditor assigned at write time. */
  confidence           REAL NOT NULL DEFAULT 0.5,
  /** JSON array of source reflexion ids that produced this guideline. */
  source_reflexion_ids TEXT NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reflexion_guidelines_tenant_slug
  ON reflexion_guidelines (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_reflexion_guidelines_per_user_updated
  ON reflexion_guidelines (tenant_id, user_id, updated_at DESC);

COMMENT ON TABLE reflexion_guidelines IS
  'Consolidated guidelines doc produced by pass-3 (update-guidelines). Tenant-scoped RLS via current_app_tenant_id() GUC helper.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ENABLE + FORCE RLS, install tenant-isolation policies on both
--    reflexion_buffer (which was created in 0134 WITHOUT RLS) and the
--    new reflexion_guidelines table.
--
--    Pattern from 0182_section_layouts.sql.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'reflexion_buffer',
    'reflexion_guidelines'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Enable + force RLS (idempotent).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical names.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT / UPDATE / DELETE.
      -- FOR ALL is correct here: pass-1 updates cluster_id, pass-4
      -- updates pruned_at, the writer inserts, the consolidation
      -- ultimately compacts away pruned rows.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: additive migration. The existing reflexion_buffer rows
-- backfill with importance = 0.5 (the column DEFAULT). The loader treats
-- NULL pruned_at as "active", so legacy rows continue to surface.
