-- ─────────────────────────────────────────────────────────────────────
-- Migration 0209 — presentation_themes (Piece H — presentation engine).
--
-- Slide-master themes used by `packages/presentation-engine/` when
-- emitting .pptx files. Each row is one theme; tenant_id NULL is a
-- platform built-in.
--
-- `slide_master_jsonb` captures the renderable shape:
--   dimensions: { width, height } in inches (default 13.333 x 7.5 — 16:9)
--   colors:     { primary, secondary, accent, text, background, muted }
--   fonts:      { title, body, accent } font-face names
--   logo_position: { x, y, w, h, anchor } in inches + anchor enum
--   layouts:    list of named slide-layouts (title / bullet / chart / image)
--               with default placeholder rects per kind
--
-- RLS:
--   * SELECT — tenant scope OR NULL (platform builtins readable by all)
--   * INSERT/UPDATE/DELETE — tenant scope strict
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS presentation_themes (
  id                 TEXT PRIMARY KEY,
  /** NULL = platform built-in. */
  tenant_id          TEXT,
  slug               TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  slide_master_jsonb JSONB NOT NULL,
  is_built_in        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_presentation_themes_slug_nonempty CHECK (length(slug) > 0),
  CONSTRAINT ck_presentation_themes_master_object CHECK (
    jsonb_typeof(slide_master_jsonb) = 'object'
  )
);

-- ============================================================================
-- 2. Indexes — partial unique pair pattern (see 0208).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_presentation_themes_platform_slug
  ON presentation_themes (slug)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_presentation_themes_tenant_slug
  ON presentation_themes (tenant_id, slug)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_presentation_themes_tenant
  ON presentation_themes (tenant_id);

COMMENT ON TABLE presentation_themes IS
  'Presentation-engine slide-master themes. tenant_id NULL = platform built-in. slide_master_jsonb is the renderable theme — dimensions, colors, fonts, logo_position, layouts. RLS allows read of NULL rows; write requires matching tenant_id.';

COMMENT ON COLUMN presentation_themes.slide_master_jsonb IS
  'Object: { dimensions:{w,h}, colors:{primary,secondary,accent,text,background,muted}, fonts:{title,body,accent}, logo_position:{x,y,w,h,anchor}, layouts:[…] }';

-- ============================================================================
-- 3. ENABLE + FORCE RLS, install policies.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'presentation_themes'
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
        USING (tenant_id IS NULL OR tenant_id = public.current_app_tenant_id());
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

-- ============================================================================
-- 4. Seed platform built-ins. Five themes:
--    classic_corporate, modern_clean, minimal_dark, government_serious, africa_warm.
-- ============================================================================

INSERT INTO presentation_themes (id, tenant_id, slug, display_name, slide_master_jsonb, is_built_in)
VALUES
  (
    'theme_classic_corporate',
    NULL,
    'classic_corporate',
    'Classic Corporate',
    '{
      "dimensions": {"w": 13.333, "h": 7.5},
      "colors": {"primary":"#1F3864","secondary":"#4472C4","accent":"#FFC000","text":"#333333","background":"#FFFFFF","muted":"#7F7F7F"},
      "fonts": {"title":"Calibri","body":"Calibri","accent":"Calibri Light"},
      "logo_position": {"x":0.4,"y":0.3,"w":1.2,"h":0.6,"anchor":"top-left"},
      "layouts": ["title","bullet","chart","image","section-divider"]
    }'::jsonb,
    TRUE
  ),
  (
    'theme_modern_clean',
    NULL,
    'modern_clean',
    'Modern Clean',
    '{
      "dimensions": {"w": 13.333, "h": 7.5},
      "colors": {"primary":"#0E7C7B","secondary":"#17BEBB","accent":"#FFC857","text":"#2D3047","background":"#FFFFFF","muted":"#A6A6A6"},
      "fonts": {"title":"Helvetica","body":"Helvetica","accent":"Helvetica"},
      "logo_position": {"x":11.733,"y":0.3,"w":1.2,"h":0.6,"anchor":"top-right"},
      "layouts": ["title","bullet","chart","image","section-divider"]
    }'::jsonb,
    TRUE
  ),
  (
    'theme_minimal_dark',
    NULL,
    'minimal_dark',
    'Minimal Dark',
    '{
      "dimensions": {"w": 13.333, "h": 7.5},
      "colors": {"primary":"#FFFFFF","secondary":"#BBBBBB","accent":"#F95738","text":"#FFFFFF","background":"#0B0C10","muted":"#666666"},
      "fonts": {"title":"Inter","body":"Inter","accent":"Inter"},
      "logo_position": {"x":0.4,"y":0.3,"w":1.2,"h":0.6,"anchor":"top-left"},
      "layouts": ["title","bullet","chart","image","section-divider"]
    }'::jsonb,
    TRUE
  ),
  (
    'theme_government_serious',
    NULL,
    'government_serious',
    'Government Serious',
    '{
      "dimensions": {"w": 13.333, "h": 7.5},
      "colors": {"primary":"#003366","secondary":"#336699","accent":"#B22222","text":"#000000","background":"#F5F5F5","muted":"#666666"},
      "fonts": {"title":"Times New Roman","body":"Times New Roman","accent":"Times New Roman"},
      "logo_position": {"x":0.4,"y":0.3,"w":0.8,"h":0.8,"anchor":"top-left"},
      "layouts": ["title","bullet","chart","image","section-divider"]
    }'::jsonb,
    TRUE
  ),
  (
    'theme_africa_warm',
    NULL,
    'africa_warm',
    'Africa Warm',
    '{
      "dimensions": {"w": 13.333, "h": 7.5},
      "colors": {"primary":"#C75B12","secondary":"#F2A65A","accent":"#3A5311","text":"#3D3027","background":"#FFF8E7","muted":"#8C6E54"},
      "fonts": {"title":"Lato","body":"Lato","accent":"Lato"},
      "logo_position": {"x":0.4,"y":0.3,"w":1.2,"h":0.6,"anchor":"top-left"},
      "layouts": ["title","bullet","chart","image","section-divider"]
    }'::jsonb,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;
