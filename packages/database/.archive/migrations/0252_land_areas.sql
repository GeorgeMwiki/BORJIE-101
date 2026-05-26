-- =============================================================================
-- 0252: land_areas — macro polygons captured by a user.
--
-- A `land_area` is the outer boundary of a real-world site that a user has
-- walked, drawn on a map, or imported. E.g. "Kariakoo plot 27 entire
-- 5-acre site". Once captured it may be subdivided into one or more
-- `parcels` (see 0253). The `core_entity_id` is a SOFT pointer — Piece A
-- holds the canonical entity registry; if Piece A migration hasn't landed
-- yet we still want to record land areas. FK will be wired up by a later
-- migration once core_entity exists.
--
-- Captured via:
--   * `manual_draw`   — user drew polygon on a map UI
--   * `gps_walk`      — user walked the boundary with GPS
--   * `gis_import`    — imported from external GIS (KML, GeoJSON, SHP)
--   * `satellite_trace` — AI-assisted tracing from satellite imagery
--
-- All polygons SRID 4326 (WGS84). `area_sqm` is precomputed via
-- `ST_Area(boundary_polygon::geography)` at insert (application
-- responsibility — kept as a column so search/filter on area is fast
-- without recomputing). `center_point` is the polygon centroid (also
-- precomputed application-side).
--
-- RLS: gold-standard tenant_isolation_select / tenant_isolation_modify
-- pattern from 0182..0185.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the land_areas table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS land_areas (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** SOFT pointer to core_entity.id (Piece A). FK wired up when Piece A lands. */
  core_entity_id          TEXT,
  display_name            TEXT NOT NULL,
  description             TEXT,
  /** Outer boundary; SRID 4326 (WGS84). */
  boundary_polygon        geography(POLYGON, 4326) NOT NULL,
  /** Precomputed centroid for cheap proximity + map placement. */
  center_point            geography(POINT, 4326) NOT NULL,
  /** Precomputed area in square metres. NULL until app computes ST_Area. */
  area_sqm                NUMERIC(14, 2),
  /** ISO 3166-1 alpha-2 country code: 'TZ', 'KE', 'NG', etc. */
  jurisdiction            TEXT NOT NULL,
  /** Sub-national region: 'Dar es Salaam', 'Tabora', 'Nairobi', etc. */
  region                  TEXT,
  /** Ward / sub-region for fine-grained land-registry lookup. */
  ward                    TEXT,
  /** Formal land-registry plot number. */
  plot_number             TEXT,
  /** How the polygon was captured. See file header. */
  captured_via            TEXT NOT NULL,
  captured_by_user_id     TEXT NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT land_areas_captured_via_chk CHECK (
    captured_via IN ('manual_draw', 'gps_walk', 'gis_import', 'satellite_trace')
  ),
  CONSTRAINT land_areas_jurisdiction_chk CHECK (
    LENGTH(jurisdiction) = 2
  )
);

COMMENT ON TABLE land_areas IS
  'Piece N: outer-boundary polygon for a real-world land site. Subdivisions live in `parcels` (0253).';

COMMENT ON COLUMN land_areas.core_entity_id IS
  'SOFT pointer to core_entity.id (Piece A). FK wired up by a later migration once Piece A lands.';

COMMENT ON COLUMN land_areas.boundary_polygon IS
  'Outer boundary as PostGIS geography(POLYGON, 4326). Use ST_Within / ST_Contains for subdivision validation.';

COMMENT ON COLUMN land_areas.area_sqm IS
  'Precomputed area in m². Application MUST set on insert via ST_Area(boundary_polygon::geography).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0182..0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'land_areas'
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
