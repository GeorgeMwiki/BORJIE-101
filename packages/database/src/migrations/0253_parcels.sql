-- =============================================================================
-- 0253: parcels — subdivisions of a land_area.
--
-- A `parcel` is a sub-polygon inside a `land_area`'s boundary. Parcels
-- can be further subdivided via `parent_parcel_id`, producing a tree:
--
--   land_area "Kariakoo plot 27" 5 acres
--     └─ parcel "27A" 2 acres (parent_parcel_id NULL)
--     │    └─ parcel "27A.1" 0.5 acres (parent_parcel_id = 27A.id)
--     │    └─ parcel "27A.2" 1.5 acres
--     └─ parcel "27B" 3 acres
--
-- Subdivision validation (application-side):
--   * ST_Within(child.boundary, parent_parcel.boundary || land_area.boundary)
--   * Siblings must not ST_Intersects each other (no overlap)
--
-- Status state machine:
--   available -> reserved -> leased / sold
--                          -> available (released)
--                          -> disputed
--                          -> unavailable
--
-- All status transitions emit a `parcel_activity_log` event (0257).
--
-- `color_hex` and `label` are user-painted decoration for map rendering
-- (e.g. paint a parcel red because it's "in negotiation"). For shared
-- meaning across a tenant use the `parcel_color_tags` palette (0258).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the parcels table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parcels (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  land_area_id            TEXT NOT NULL REFERENCES land_areas(id) ON DELETE CASCADE,
  /** NULL = top-level subdivision of land_area; non-NULL = sub-subdivision. */
  parent_parcel_id        TEXT REFERENCES parcels(id) ON DELETE CASCADE,
  /** SOFT pointer to core_entity.id (Piece A) — kind=LAND_PARCEL. */
  core_entity_id          TEXT,
  display_name            TEXT NOT NULL,
  boundary_polygon        geography(POLYGON, 4326) NOT NULL,
  center_point            geography(POINT, 4326) NOT NULL,
  area_sqm                NUMERIC(14, 2),
  /** Sub-numbering like '27A', '27B', '27A.1'. */
  parcel_number           TEXT,
  /** Lifecycle status. Default 'available' on creation. */
  status                  TEXT NOT NULL DEFAULT 'available',
  status_changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** User-painted hex colour for map rendering. */
  color_hex               TEXT,
  /** Short tag like 'Warehouse plot' or 'Future expansion'. */
  label                   TEXT,
  /** Coarse zoning bucket. */
  zoning                  TEXT,
  /** Fine-grained intended land use. */
  land_use                TEXT,
  /** Frontage on adjoining road in metres (valuation input). */
  road_frontage_m         NUMERIC(8, 2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT parcels_status_chk CHECK (
    status IN ('available', 'reserved', 'leased', 'sold', 'disputed', 'unavailable')
  ),
  CONSTRAINT parcels_zoning_chk CHECK (
    zoning IS NULL OR zoning IN (
      'residential', 'commercial', 'industrial', 'mixed', 'undeveloped', 'special'
    )
  ),
  CONSTRAINT parcels_color_hex_chk CHECK (
    color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'
  )
);

COMMENT ON TABLE parcels IS
  'Piece N: subdivisions of a land_area. Supports nested subdivision via parent_parcel_id.';

COMMENT ON COLUMN parcels.parent_parcel_id IS
  'NULL = top-level subdivision of land_area; non-NULL = sub-subdivision of another parcel.';

COMMENT ON COLUMN parcels.status IS
  'Lifecycle status: available | reserved | leased | sold | disputed | unavailable. Transitions logged to parcel_activity_log.';

COMMENT ON COLUMN parcels.color_hex IS
  'User-painted hex colour like #FF5722 for map rendering. For shared tenant palette use parcel_color_tags.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS — tenant isolation pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcels'
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
