-- =============================================================================
-- 0264: layout_overrides — Piece O section-level overrides.
--
-- Sister to tab_personalization (0263) but section-scoped and finer-
-- grained. Where tab_personalization holds a USER's preferred ordering
-- per tab, layout_overrides lets either the tenant OR a specific user
-- nudge an INDIVIDUAL section's behaviour: hide it, reposition it, pass
-- props to it.
--
-- The personalization engine reads layout_overrides last (highest
-- priority by `priority` column) so a tenant-wide rule "compliance
-- section ALWAYS pinned for accountants" can coexist with user-specific
-- "John always hides the news widget".
--
-- override_kind is a TEXT enum:
--   * 'visibility' — payload {hidden: bool}
--   * 'position'   — payload {pinned: bool, sort_offset: number}
--   * 'props'      — payload {props: object} merged into section props
--
-- This migration:
--   1. Creates `layout_overrides` table — user_id NULL = tenant-wide.
--   2. Indexes for the engine's read path.
--   3. GOLD-STANDARD RLS via `public.current_app_tenant_id()` (0172).
--      Note: user_id is NULLABLE; the RLS predicate only enforces
--      tenant scope, not user-scope (that's an app-layer concern since
--      a user can see tenant-wide rules that affect their layout).
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS layout_overrides (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** NULL = tenant-wide override; non-NULL = user-specific. */
  user_id          TEXT,
  /** Soft TEXT pointer — which dynamic-sections section this applies to. */
  section_id       TEXT NOT NULL,
  /** TEXT enum: visibility | position | props. */
  override_kind    TEXT NOT NULL,
  /** Payload shape depends on override_kind (see file header). */
  override_jsonb   JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Higher = wins on conflict. Engine sorts overrides by priority desc. */
  priority         SMALLINT NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT layout_overrides_kind_check CHECK (
    override_kind IN ('visibility', 'position', 'props')
  )
);

CREATE INDEX IF NOT EXISTS layout_overrides_tenant_section_idx
  ON layout_overrides (tenant_id, section_id, priority DESC);

CREATE INDEX IF NOT EXISTS layout_overrides_tenant_user_section_idx
  ON layout_overrides (tenant_id, user_id, section_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS layout_overrides_tenant_wide_idx
  ON layout_overrides (tenant_id, section_id) WHERE user_id IS NULL;

COMMENT ON TABLE layout_overrides IS
  'Piece O — section-level overrides. Sister to tab_personalization. user_id NULL = tenant-wide rule; non-NULL = user-specific. Engine merges by priority desc.';

COMMENT ON COLUMN layout_overrides.override_kind IS
  'TEXT enum: visibility (hidden bool) | position (pinned + sort_offset) | props (merged into section props).';

COMMENT ON COLUMN layout_overrides.priority IS
  'Higher = wins. Default 100. User-specific rules typically use 200+; tenant defaults use 50-150.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'layout_overrides'
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

-- Operator note: this table grows slowly (one row per explicit override).
-- Engine reads via the section-id index; no need for partition or
-- archival until 10K+ overrides per tenant which is unlikely.
