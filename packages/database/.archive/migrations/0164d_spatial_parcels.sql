-- Migration 0164 — Spatial parcel engine (Muzima v1).
--
-- Implements the storage layer for the Muzima spatial parcel subsystem
-- as scoped by `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md`
-- (Wave-3 task #12).
--
-- Backwards compatibility: all new tables and indexes are guarded by
-- `IF NOT EXISTS`. No destructive ALTERs against existing tables. The
-- closest name-collision risk was `units` (already exists for leasable
-- units in property.schema.ts); we use `parcel_units` instead.
--
-- IMPORTANT (legal): EA cadastral APIs are non-public. Every polygon
-- row stores `authoritative_source` + `accuracy_m` provenance. The UI
-- must never assert legal ownership; it surfaces *derived geometry*
-- with provenance + accuracy bands.
--
-- Tables created (all SRID 4326 / WGS84):
--   parcels                 — top-level land parcel polygon
--   buildings               — building footprints inside a parcel
--   floors                  — floor polygons / extrusion levels
--   parcel_units            — unit polygons (renting unit shape; NOT
--                             the leasable-unit row in `units`)
--   rooms                   — room polygons inside a unit
--   elements                — fixtures / fittings / sub-elements
--   map_layers              — per-tenant layer-style definitions
--   element_photos          — photos attached to elements
--   ref_overture_buildings  — read-only Overture v2026-04-15 cache
--   ref_google_open_buildings — read-only Google Open Buildings v3 cache

-- ============================================================================
-- 0. Extensions
-- ============================================================================

-- PostGIS — wrapped in DO/EXCEPTION so apply-check against a stock
-- Postgres image (no PostGIS) emits a NOTICE instead of aborting the
-- migration chain. Downstream `geometry(...)` columns + ST_* calls
-- will still error if PostGIS is genuinely absent at runtime — this
-- only prevents apply-check on bare Postgres from short-circuiting
-- the whole migration sequence before later RLS/constraint migrations
-- get a chance to run.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '0164d_spatial_parcels: postgis unavailable: %', SQLERRM;
END $$;

-- h3 + h3_postgis are optional in some self-hosted deployments. Guard
-- with DO blocks so a missing extension does not abort the migration —
-- H3 indexes degrade to NULL columns + plain GIST indexes.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS h3;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '0164: h3 extension unavailable (%); H3 indexes will be skipped.', SQLERRM;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS h3_postgis;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '0164: h3_postgis extension unavailable (%); H3 indexes will be skipped.', SQLERRM;
  END;
END
$$;

-- ============================================================================
-- 1. parcels
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.parcels (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL,
  property_id          text,  -- optional FK to existing properties.id
  name                 text NOT NULL,
  boundary             geometry(MultiPolygon, 4326) NOT NULL,
  centroid             geometry(Point, 4326) NOT NULL,
  area_sqm             double precision NOT NULL,
  h3_r10               text,  -- resolution-10 H3 cell (parcel scale)
  authoritative_source text NOT NULL DEFAULT 'user_traced',
  accuracy_m           double precision NOT NULL DEFAULT 5.0,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcels_authoritative_source_chk
    CHECK (authoritative_source IN (
      'user_traced', 'overture', 'google_open_buildings', 'osm',
      'sam_assisted', 'gps_walk', 'cadastral_authority', 'unknown'
    )),
  CONSTRAINT parcels_accuracy_chk CHECK (accuracy_m >= 0)
);

CREATE INDEX IF NOT EXISTS parcels_boundary_gist ON public.parcels USING GIST (boundary);
CREATE INDEX IF NOT EXISTS parcels_centroid_gist ON public.parcels USING GIST (centroid);
CREATE INDEX IF NOT EXISTS parcels_tenant_idx ON public.parcels (tenant_id);
CREATE INDEX IF NOT EXISTS parcels_property_idx ON public.parcels (property_id);
CREATE INDEX IF NOT EXISTS parcels_h3_r10_idx ON public.parcels (h3_r10);

-- ============================================================================
-- 2. buildings
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buildings (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL,
  parcel_id            text NOT NULL REFERENCES public.parcels(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  footprint            geometry(Polygon, 4326) NOT NULL,
  height_m             double precision,
  num_floors           integer NOT NULL DEFAULT 1 CHECK (num_floors >= 0),
  h3_r12               text,  -- resolution-12 H3 cell (building scale)
  authoritative_source text NOT NULL DEFAULT 'user_traced',
  accuracy_m           double precision NOT NULL DEFAULT 5.0,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buildings_authoritative_source_chk
    CHECK (authoritative_source IN (
      'user_traced', 'overture', 'google_open_buildings', 'osm',
      'microsoft_ml_footprints', 'sam_assisted', 'gps_walk', 'unknown'
    )),
  CONSTRAINT buildings_accuracy_chk CHECK (accuracy_m >= 0)
);

CREATE INDEX IF NOT EXISTS buildings_footprint_gist ON public.buildings USING GIST (footprint);
CREATE INDEX IF NOT EXISTS buildings_tenant_idx ON public.buildings (tenant_id);
CREATE INDEX IF NOT EXISTS buildings_parcel_idx ON public.buildings (parcel_id);
CREATE INDEX IF NOT EXISTS buildings_h3_r12_idx ON public.buildings (h3_r12);

-- ============================================================================
-- 3. floors
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.floors (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL,
  building_id   text NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  level         integer NOT NULL,  -- 0 = ground; -1 = basement; etc.
  name          text NOT NULL,
  outline       geometry(Polygon, 4326),
  area_sqm      double precision,
  height_m      double precision,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, level)
);

CREATE INDEX IF NOT EXISTS floors_outline_gist ON public.floors USING GIST (outline);
CREATE INDEX IF NOT EXISTS floors_tenant_idx ON public.floors (tenant_id);
CREATE INDEX IF NOT EXISTS floors_building_idx ON public.floors (building_id);

-- ============================================================================
-- 4. parcel_units
--    NOTE: separate from `units` table (leasable units). This row models
--    the *geometric* unit shape inside a building floor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.parcel_units (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  floor_id        text NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
  -- Optional link to the leasable `units` row created in
  -- property.schema.ts. Not enforced as FK here because that table
  -- pre-dates the parcel schema and may be missing in test envs.
  leasable_unit_id text,
  unit_code       text NOT NULL,
  outline         geometry(Polygon, 4326) NOT NULL,
  area_sqm        double precision NOT NULL,
  occupancy_status text NOT NULL DEFAULT 'unknown',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcel_units_occupancy_chk
    CHECK (occupancy_status IN (
      'vacant', 'occupied', 'reserved', 'under_maintenance',
      'not_available', 'unknown'
    ))
);

CREATE INDEX IF NOT EXISTS parcel_units_outline_gist ON public.parcel_units USING GIST (outline);
CREATE INDEX IF NOT EXISTS parcel_units_tenant_idx ON public.parcel_units (tenant_id);
CREATE INDEX IF NOT EXISTS parcel_units_floor_idx ON public.parcel_units (floor_id);

-- ============================================================================
-- 5. rooms
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rooms (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  parcel_unit_id  text NOT NULL REFERENCES public.parcel_units(id) ON DELETE CASCADE,
  name            text NOT NULL,
  room_type       text NOT NULL DEFAULT 'other',
  outline         geometry(Polygon, 4326) NOT NULL,
  area_sqm        double precision NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rooms_room_type_chk
    CHECK (room_type IN (
      'bedroom', 'bathroom', 'kitchen', 'living', 'dining',
      'office', 'storage', 'utility', 'balcony', 'corridor',
      'commercial', 'other'
    ))
);

CREATE INDEX IF NOT EXISTS rooms_outline_gist ON public.rooms USING GIST (outline);
CREATE INDEX IF NOT EXISTS rooms_tenant_idx ON public.rooms (tenant_id);
CREATE INDEX IF NOT EXISTS rooms_parcel_unit_idx ON public.rooms (parcel_unit_id);

-- ============================================================================
-- 6. elements (fixtures, fittings, taggable points)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.elements (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  room_id         text REFERENCES public.rooms(id) ON DELETE CASCADE,
  parcel_unit_id  text REFERENCES public.parcel_units(id) ON DELETE CASCADE,
  building_id     text REFERENCES public.buildings(id) ON DELETE CASCADE,
  -- An element MUST attach to exactly one of room/parcel_unit/building.
  -- Enforced by a CHECK below (one-of-three non-null).
  element_type    text NOT NULL,
  status          text NOT NULL DEFAULT 'unknown',
  condition       text NOT NULL DEFAULT 'unknown',
  geom            geometry(Geometry, 4326) NOT NULL,  -- Point/Line/Poly
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elements_status_chk
    CHECK (status IN (
      'operational', 'degraded', 'broken', 'needs_repair',
      'decommissioned', 'unknown'
    )),
  CONSTRAINT elements_condition_chk
    CHECK (condition IN (
      'excellent', 'good', 'fair', 'poor', 'critical', 'unknown'
    )),
  CONSTRAINT elements_parent_one_of
    CHECK (
      (room_id IS NOT NULL)::int
      + (parcel_unit_id IS NOT NULL)::int
      + (building_id IS NOT NULL)::int
      = 1
    )
);

CREATE INDEX IF NOT EXISTS elements_geom_gist ON public.elements USING GIST (geom);
CREATE INDEX IF NOT EXISTS elements_tenant_idx ON public.elements (tenant_id);
CREATE INDEX IF NOT EXISTS elements_room_idx ON public.elements (room_id);
CREATE INDEX IF NOT EXISTS elements_type_idx ON public.elements (element_type);
CREATE INDEX IF NOT EXISTS elements_status_idx ON public.elements (status);

-- ============================================================================
-- 7. map_layers — per-tenant layer-style definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.map_layers (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL,
  name        text NOT NULL,
  layer_kind  text NOT NULL,
  -- visualisation rules (palette, breakpoints, joins) as JSON blob
  style       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT map_layers_kind_chk
    CHECK (layer_kind IN (
      'occupancy', 'condition', 'status', 'arrears', 'compliance',
      'maintenance', 'rent_band', 'custom'
    ))
);

CREATE INDEX IF NOT EXISTS map_layers_tenant_idx ON public.map_layers (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS map_layers_tenant_default_uniq
  ON public.map_layers (tenant_id, layer_kind) WHERE is_default;

-- ============================================================================
-- 8. element_photos
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.element_photos (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  element_id      text NOT NULL REFERENCES public.elements(id) ON DELETE CASCADE,
  storage_url     text NOT NULL,
  capture_geom    geometry(Point, 4326),
  captured_at     timestamptz NOT NULL DEFAULT now(),
  uploaded_by     text,
  width_px        integer,
  height_px       integer,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS element_photos_tenant_idx ON public.element_photos (tenant_id);
CREATE INDEX IF NOT EXISTS element_photos_element_idx ON public.element_photos (element_id);
CREATE INDEX IF NOT EXISTS element_photos_capture_gist ON public.element_photos USING GIST (capture_geom);

-- ============================================================================
-- 9. ref_overture_buildings — read-only cache of Overture footprints
--    (no tenant_id — global reference; tenants snap *against* it)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ref_overture_buildings (
  id            text PRIMARY KEY,
  overture_id   text NOT NULL,
  footprint     geometry(Polygon, 4326) NOT NULL,
  height_m      double precision,
  num_floors    integer,
  country_code  text,
  release_tag   text NOT NULL DEFAULT '2026-04-15.0',
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ref_overture_footprint_gist
  ON public.ref_overture_buildings USING GIST (footprint);
CREATE INDEX IF NOT EXISTS ref_overture_country_idx
  ON public.ref_overture_buildings (country_code);
CREATE UNIQUE INDEX IF NOT EXISTS ref_overture_overture_id_uniq
  ON public.ref_overture_buildings (overture_id, release_tag);

-- ============================================================================
-- 10. ref_google_open_buildings — read-only cache of Google v3 polygons
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ref_google_open_buildings (
  id              text PRIMARY KEY,
  google_id       text NOT NULL,
  footprint       geometry(Polygon, 4326) NOT NULL,
  area_sqm        double precision,
  confidence      double precision,
  country_code    text,
  release_tag     text NOT NULL DEFAULT 'v3',
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ref_google_open_buildings_confidence_chk
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS ref_google_open_footprint_gist
  ON public.ref_google_open_buildings USING GIST (footprint);
CREATE INDEX IF NOT EXISTS ref_google_open_country_idx
  ON public.ref_google_open_buildings (country_code);
CREATE UNIQUE INDEX IF NOT EXISTS ref_google_open_google_id_uniq
  ON public.ref_google_open_buildings (google_id, release_tag);

-- ============================================================================
-- 11. Row-level security — tenant isolation
--    Pattern mirrors 0155/0156/0163: ENABLE + FORCE + select/modify
--    policies keyed on `current_app_tenant_id()`.
--    Reference tables (ref_*) are PUBLIC READ — they are global open-data
--    caches and contain no tenant data.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcels', 'buildings', 'floors', 'parcel_units', 'rooms',
    'elements', 'map_layers', 'element_photos'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
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
      USING (tenant_id::text = public.current_app_tenant_id());
    $pol$, tbl);

    EXECUTE format($pol$
      CREATE POLICY tenant_isolation_modify ON public.%I
      FOR ALL
      TO authenticated
      USING (tenant_id::text = public.current_app_tenant_id())
      WITH CHECK (tenant_id::text = public.current_app_tenant_id());
    $pol$, tbl);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
  END LOOP;
END
$$;

-- Reference tables (ref_*) are intentionally PUBLIC READ.
-- Writes are restricted by a separate ingestion role (see operator docs).

-- ============================================================================
-- 12. Comments — operator-facing notes
-- ============================================================================

COMMENT ON TABLE public.parcels IS
  '0164 — Top-level land parcel polygon. Provenance via authoritative_source. NEVER assert legal ownership.';
COMMENT ON TABLE public.buildings IS
  '0164 — Building footprints inside a parcel. Snap target for Overture/Google Open Buildings.';
COMMENT ON TABLE public.parcel_units IS
  '0164 — Geometric unit shape. Distinct from leasable `units`; link via leasable_unit_id when known.';
COMMENT ON TABLE public.ref_overture_buildings IS
  '0164 — Read-only cache of Overture Maps Foundation building footprints (CDLA 2.0).';
COMMENT ON TABLE public.ref_google_open_buildings IS
  '0164 — Read-only cache of Google Open Buildings v3 footprints (CC BY-4.0).';
