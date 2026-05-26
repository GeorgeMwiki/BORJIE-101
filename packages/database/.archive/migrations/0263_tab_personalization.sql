-- =============================================================================
-- 0263: tab_personalization — Piece O per-user layout overrides.
--
-- When a tab spawns, the personalization-engine computes a section
-- ordering tailored to the user (mastery + recency + frustration). The
-- resolved override is persisted here so a returning user lands on the
-- same surface they configured. This is a sister table to
-- `section_layouts` (0182) but tab-scoped — one row per
-- (tenant, user, module_id) so each spawned tab has its own profile.
--
-- `module_id` is a soft TEXT pointer — the module/tab registry lands in
-- Piece B; today it's just a string label that matches the spawned
-- tab's identifier.
--
-- Mastery_level gates progressive disclosure: novice (0-30) collapses
-- advanced sections, intermediate (31-70) exposes them, expert (71-100)
-- lets pro panels float to top. The personalization engine computes
-- this from `user_action_tracker` (0183) + the user's domain history.
--
-- This migration:
--   1. Creates `tab_personalization` table with unique (tenant, user,
--      module) so a user has exactly one override row per tab.
--   2. GOLD-STANDARD RLS via `public.current_app_tenant_id()` (0172).
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tab_personalization (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL,
  /**
   * Soft TEXT pointer to the module/tab catalogue (Piece B). NULL is
   * legal and represents tenant-wide personalization defaults — not
   * tied to a specific tab. Convention: NULL is a synthetic "default"
   * row that the engine applies before tab-specific overrides.
   */
  module_id               TEXT,
  /** JSONB-encoded SectionId[] — ordered list of section_ids the user prefers. */
  section_order_jsonb     JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Section ids the user has hidden in this tab. */
  hidden_section_ids      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /** Density: compact (denser rows), comfortable (default), spacious. */
  density_preference      TEXT NOT NULL DEFAULT 'comfortable',
  /** 0-100 mastery score; gates progressive disclosure. */
  mastery_level           SMALLINT NOT NULL DEFAULT 0,
  /** Free-form props persisted at the personalisation layer (filters, …). */
  custom_props_jsonb      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tab_personalization_density_check CHECK (
    density_preference IN ('compact', 'comfortable', 'spacious')
  ),
  CONSTRAINT tab_personalization_mastery_check CHECK (
    mastery_level >= 0 AND mastery_level <= 100
  )
);

-- Partial unique indexes — Postgres treats NULL as distinct in unique
-- constraints, so to enforce ONE row per (tenant, user, NULL module) we
-- use a partial index for the NULL case and a regular unique for the
-- non-NULL case.
CREATE UNIQUE INDEX IF NOT EXISTS tab_personalization_user_module_unique_idx
  ON tab_personalization (tenant_id, user_id, module_id)
  WHERE module_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tab_personalization_user_default_unique_idx
  ON tab_personalization (tenant_id, user_id)
  WHERE module_id IS NULL;

CREATE INDEX IF NOT EXISTS tab_personalization_tenant_module_idx
  ON tab_personalization (tenant_id, module_id);

COMMENT ON TABLE tab_personalization IS
  'Piece O — per-user layout overrides for spawned tabs. One row per (tenant, user, module). NULL module_id is the tenant-default override.';

COMMENT ON COLUMN tab_personalization.module_id IS
  'Soft TEXT pointer to module/tab catalogue (Piece B). NULL = tenant-default personalisation applied before module-specific overrides.';

COMMENT ON COLUMN tab_personalization.mastery_level IS
  '0-100 score. Computed from user_action_tracker (0183) by the personalization engine. Gates progressive disclosure (novice<31, intermediate<71, expert>=71).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tab_personalization'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: this table is read on every tab render, so write-heavy
-- side is light (only on explicit personalisation events). updated_at
-- is bumped by the application; consider a touch-trigger in a follow-up
-- if external writers proliferate.
