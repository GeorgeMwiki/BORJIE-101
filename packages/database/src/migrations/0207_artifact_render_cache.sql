-- =============================================================================
-- 0207: artifact_render_cache — Piece G server-side render cache.
--
-- The api-gateway exposes `GET /api/v1/artifacts/:id/render?format=png|pdf|svg`
-- which rasterises a `ui_artifacts` row to bytes using Playwright. The
-- result is cached in this table keyed by (artifact_id, output_format).
-- WhatsApp media-send and email-attachment pipelines consume these
-- rasterised bytes.
--
-- Cache invalidation:
--   * Hard delete row → cascade from ui_artifacts(id) ON DELETE CASCADE.
--   * Expiry → `expires_at`; the wiring sweep drops expired rows nightly.
--   * Content hash mismatch → renderer recomputes and replaces in-place.
--
-- The cache is tenant-scoped TRANSITIVELY (via the FK to ui_artifacts which
-- IS tenant-scoped), but RLS is enforced HERE too so a cross-tenant
-- attempt to read the cache directly is blocked even if a future code path
-- forgets to JOIN through ui_artifacts. The RLS policy uses a SECURITY
-- DEFINER helper that resolves the parent tenant_id; cheaper than the
-- common `tenant_id` column duplication and never goes stale.
--
-- Schema:
--   id                  : ULID/text PRIMARY KEY
--   artifact_id         : FK → ui_artifacts(id), cascade-on-delete
--   output_format       : 'png' | 'pdf' | 'svg' | 'html'
--   content_bytes       : raw render bytes
--   content_hash        : SHA-256 over content_bytes; integrity check
--   size_bytes          : derived; useful for budget enforcement
--   created_at          : write timestamp
--   expires_at          : NULL = forever (until parent is mutated)
--
-- Unique on (artifact_id, output_format).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Resolver helper — returns the tenant_id of the parent artifact.
--    SECURITY DEFINER so it can see ui_artifacts without the caller's
--    RLS clause; the SQL body itself filters by id so it leaks nothing.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.artifact_render_cache_owner_tenant_id(
  p_artifact_id TEXT
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.ui_artifacts WHERE id = p_artifact_id;
$$;

REVOKE EXECUTE ON FUNCTION public.artifact_render_cache_owner_tenant_id(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.artifact_render_cache_owner_tenant_id(TEXT) TO authenticated;

COMMENT ON FUNCTION public.artifact_render_cache_owner_tenant_id(TEXT) IS
  'Resolves tenant_id of the parent ui_artifact. Used by artifact_render_cache RLS so the cache table need not duplicate tenant_id.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. artifact_render_cache table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artifact_render_cache (
  id                  TEXT PRIMARY KEY,
  artifact_id         TEXT NOT NULL REFERENCES ui_artifacts(id) ON DELETE CASCADE,
  /**
   * Output format. TEXT (not pgEnum) so new formats (webp, gif, mp4 for
   * exported animated KPI grids) can ship without a migration.
   */
  output_format       TEXT NOT NULL,
  content_bytes       BYTEA NOT NULL,
  /** SHA-256 hex of content_bytes; pads detect cache poisoning. */
  content_hash        TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  UNIQUE (artifact_id, output_format)
);

CREATE INDEX IF NOT EXISTS artifact_render_cache_artifact_idx
  ON artifact_render_cache (artifact_id);

CREATE INDEX IF NOT EXISTS artifact_render_cache_expires_idx
  ON artifact_render_cache (expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE artifact_render_cache IS
  'Per-(artifact, format) cache of Playwright-rendered bytes. Consumed by WhatsApp media-send and email-attachment pipelines.';

COMMENT ON COLUMN artifact_render_cache.content_hash IS
  'SHA-256 over content_bytes. Used to detect tampering or stale renders when an artifact is revised but the cache row was not invalidated.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Indirect-tenant RLS pattern.
--    The cache row inherits its tenant from ui_artifacts(artifact_id).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'artifact_render_cache'
  ) THEN
    ALTER TABLE public.artifact_render_cache ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.artifact_render_cache FORCE  ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation_select ON public.artifact_render_cache;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.artifact_render_cache;

    CREATE POLICY tenant_isolation_select ON public.artifact_render_cache
      FOR SELECT
      TO authenticated
      USING (
        public.artifact_render_cache_owner_tenant_id(artifact_id)
          = public.current_app_tenant_id()
      );

    CREATE POLICY tenant_isolation_modify ON public.artifact_render_cache
      FOR ALL
      TO authenticated
      USING (
        public.artifact_render_cache_owner_tenant_id(artifact_id)
          = public.current_app_tenant_id()
      )
      WITH CHECK (
        public.artifact_render_cache_owner_tenant_id(artifact_id)
          = public.current_app_tenant_id()
      );

    REVOKE ALL ON public.artifact_render_cache FROM anon;
  END IF;
END
$$;

-- Operator note: cache writes go through the service-role client (which
-- bypasses RLS); cache reads come from the authenticated role (which sees
-- only its tenant's rows via the SECURITY DEFINER resolver above). Direct
-- access by anon is revoked.
