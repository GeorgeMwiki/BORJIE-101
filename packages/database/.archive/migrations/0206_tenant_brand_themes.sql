-- =============================================================================
-- 0206: tenant_brand_themes — Piece G tenant-level brand override tokens.
--
-- Each tenant may register one or more named brand themes (default + e.g.
-- holiday-edition / dark-mode / sub-brand). Every `ui_artifacts` row may
-- optionally pin itself to a named theme via `theme_token_set_id`; the
-- AdaptiveRenderer resolves the theme via:
--
--   artifact.theme_token_set_id
--   → tenant_brand_themes(tenant_id = current, name = 'default')
--   → platform default (compiled-in fallback in `packages/genui`).
--
-- All charts, KPI tiles, callouts and gauges pull their OKLCH colour tokens
-- from the resolved theme. Logos appear in deck slides + PDF / PNG SSR
-- exports.
--
-- Schema:
--   id                    : ULID/text PRIMARY KEY
--   tenant_id             : FK → tenants(id), cascade-on-delete
--   name                  : 'default' | 'dark' | 'safari-edition' | …
--                           (unique per tenant; the kernel always emits
--                           against a named theme)
--   primary_color         : OKLCH-string (#hex accepted for back-compat)
--   secondary_color       : same
--   accent_color          : same
--   font_family_heading   : CSS font-family value
--   font_family_body      : CSS font-family value
--   logo_url              : signed URL to the tenant logo (PNG / SVG)
--   favicon_url           : optional favicon
--   custom_css            : escape hatch (DOMPurify-sanitised at render)
--   created_at            : write timestamp
--
-- Also: install the deferred FK from ui_artifacts.theme_token_set_id →
-- tenant_brand_themes(id) that 0205 could not declare in-band (the target
-- table did not yet exist).
--
-- RLS: same gold pattern as 0185.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. tenant_brand_themes table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_brand_themes (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL DEFAULT 'default',
  /**
   * Colour tokens. Stored as TEXT for forward-compat with OKLCH /
   * P3-display-gamut palettes. The renderer converts hex → OKLCH at
   * runtime if needed. Defaults match the platform fallback.
   */
  primary_color         TEXT NOT NULL DEFAULT '#0F172A',
  secondary_color       TEXT NOT NULL DEFAULT '#10B981',
  accent_color          TEXT NOT NULL DEFAULT '#F59E0B',
  font_family_heading   TEXT NOT NULL DEFAULT 'Inter',
  font_family_body      TEXT NOT NULL DEFAULT 'Inter',
  logo_url              TEXT,
  favicon_url           TEXT,
  /**
   * Escape hatch for tenants with niche branding constraints. Sanitised by
   * DOMPurify at render boundary; only declarations targeting our token
   * classes survive.
   */
  custom_css            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS tenant_brand_themes_tenant_idx
  ON tenant_brand_themes (tenant_id);

COMMENT ON TABLE tenant_brand_themes IS
  'Per-tenant brand themes (named token sets). Resolved by AdaptiveRenderer when an artifact pins theme_token_set_id; otherwise tenant default; otherwise platform fallback.';

COMMENT ON COLUMN tenant_brand_themes.custom_css IS
  'Optional sanitised CSS override. DOMPurify strips dangerous declarations at the render boundary; only known token classes pass through.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Deferred FK ui_artifacts.theme_token_set_id → tenant_brand_themes(id).
--    The 0205 migration declared the column but could not add the FK
--    because this target table did not exist yet. Idempotent: only add
--    if not already there.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ui_artifacts'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'ui_artifacts'
      AND constraint_name = 'ui_artifacts_theme_token_set_id_fkey'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.ui_artifacts
      ADD CONSTRAINT ui_artifacts_theme_token_set_id_fkey
      FOREIGN KEY (theme_token_set_id)
      REFERENCES public.tenant_brand_themes(id)
      ON DELETE SET NULL
    $sql$;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tenant_brand_themes'
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
