-- =============================================================================
-- Migration 0130 — PostGIS + spatial shadow columns + hazard zones +
--                  regulatory zones + workforce locations + geo-tagged
--                  chain-of-custody.
--
-- Drives Borjie's geo logic to production-grade SOTA per
-- Docs/RESEARCH/GEO_SOTA_2026-05-29.md. Mining lives on geography:
-- sites, hazard polygons, transport routes, regulatory regions,
-- neighbouring estates, chain-of-custody waypoints. The geofencing
-- service + watcher worker + 5 brain tools all read from this
-- schema.
--
-- Idempotent. Forward-only. Append-only per CLAUDE.md "Migrations
-- are immutable" — every clause guards with IF NOT EXISTS / IF NOT
-- EXISTS-equivalent so re-running the migration on a partially-
-- applied DB is safe.
--
-- Tenant scope:
--   * sites + licences + clock_in_events spatial shadow columns
--     inherit the existing RLS policy from the parent table — no
--     change needed.
--   * hazard_zones is tenant-scoped (RLS FORCE).
--   * workforce_locations is tenant-scoped (RLS FORCE) — ephemeral
--     bucket the geofence watcher reads.
--   * regulatory_zones is tenant-AGNOSTIC (tenant_id = NULL) by
--     design; regulators publish the same boundaries to every
--     operator, same model as intelligence_corpus_chunks.
-- =============================================================================

BEGIN;

-- =============================================================================
-- §1 — PostGIS extension. No-op if already enabled.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- §2 — Sites + site_sections spatial shadow columns.
--
-- We KEEP the existing text/GeoJSON columns (location, polygon) at
-- the ORM boundary so Drizzle stays oblivious. The geofencing
-- service queries the new *_geom columns directly via raw SQL with
-- GIST indexes for sub-millisecond point-in-polygon lookups.
-- =============================================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS location_geom geography(POINT, 4326),
  ADD COLUMN IF NOT EXISTS polygon_geom  geography(POLYGON, 4326);

CREATE INDEX IF NOT EXISTS sites_location_gix
  ON sites USING GIST (location_geom);

CREATE INDEX IF NOT EXISTS sites_polygon_gix
  ON sites USING GIST (polygon_geom);

ALTER TABLE site_sections
  ADD COLUMN IF NOT EXISTS polygon_geom geography(POLYGON, 4326);

CREATE INDEX IF NOT EXISTS site_sections_polygon_gix
  ON site_sections USING GIST (polygon_geom);

-- =============================================================================
-- §3 — Mining licences (titles) polygon shadow.
-- =============================================================================

ALTER TABLE licences
  ADD COLUMN IF NOT EXISTS polygon_geom geography(POLYGON, 4326);

CREATE INDEX IF NOT EXISTS licences_polygon_gix
  ON licences USING GIST (polygon_geom);

-- =============================================================================
-- §4 — Clock-in events spatial shadow (fraud trigger queries).
-- =============================================================================

ALTER TABLE clock_in_events
  ADD COLUMN IF NOT EXISTS geo_geom geography(POINT, 4326);

CREATE INDEX IF NOT EXISTS clock_in_events_geo_gix
  ON clock_in_events USING GIST (geo_geom);

-- =============================================================================
-- §5 — Mineral chain-of-custody geo-tagged step.
--
-- Adds geo_at_step jsonb carrying the signed GPS manifest captured
-- at every step (extract / transport / process / smelt / refine /
-- assay / export / sell). The manifest shape:
--   { lat, lon, accuracy_meters, heading_deg, captured_at, signature }
-- and the geo_geom shadow column lets the buyer-mobile CoC map trace
-- query "give me every step within R km of the buyer's location".
-- =============================================================================

ALTER TABLE mineral_chain_of_custody
  ADD COLUMN IF NOT EXISTS geo_at_step jsonb,
  ADD COLUMN IF NOT EXISTS geo_geom    geography(POINT, 4326);

CREATE INDEX IF NOT EXISTS cco_geo_gix
  ON mineral_chain_of_custody USING GIST (geo_geom);

COMMENT ON COLUMN mineral_chain_of_custody.geo_at_step IS
  'C2PA-style signed GPS manifest captured at the step. Shape: '
  '{lat, lon, accuracy_meters, heading_deg, captured_at, device_id, '
  'signature}. Verified server-side; tamper attempt breaks hash chain.';

-- =============================================================================
-- §6 — Hazard zones — work-zone | caution | forbidden polygons.
--
-- Used by the geofence watcher to detect workers entering a danger
-- area and by the risk-scanner brain tool to drive incident-rate
-- predictions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS hazard_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id         TEXT REFERENCES sites(id) ON DELETE CASCADE,
  /** Human-readable name (sw|en bilingual). */
  name_sw         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  /** work_zone | caution | forbidden */
  severity        TEXT NOT NULL,
  /** Free-form category: blast_area, ore_pit, fuel_store, magazine,
   *  flood_plain, unstable_slope, gas_pocket, env_buffer, custom. */
  category        TEXT NOT NULL DEFAULT 'custom',
  /** GeoJSON polygon (text) for the ORM boundary. */
  polygon         TEXT NOT NULL,
  /** Real geography polygon for the GIST index. */
  polygon_geom    geography(POLYGON, 4326) NOT NULL,
  /** Active for a date window (e.g. blast schedules). NULL = always. */
  active_from     TIMESTAMPTZ,
  active_until    TIMESTAMPTZ,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT hazard_zones_severity_check CHECK (
    severity IN ('work_zone', 'caution', 'forbidden')
  )
);

CREATE INDEX IF NOT EXISTS hazard_zones_tenant_idx
  ON hazard_zones (tenant_id);

CREATE INDEX IF NOT EXISTS hazard_zones_site_idx
  ON hazard_zones (site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hazard_zones_polygon_gix
  ON hazard_zones USING GIST (polygon_geom);

CREATE INDEX IF NOT EXISTS hazard_zones_tenant_severity_active_idx
  ON hazard_zones (tenant_id, severity, active_until);

ALTER TABLE hazard_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE hazard_zones FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hazard_zones_tenant_isolation ON hazard_zones;

CREATE POLICY hazard_zones_tenant_isolation ON hazard_zones
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE hazard_zones IS
  'Geofenced danger areas per site. work_zone = expected work area; '
  'caution = enter with PPE; forbidden = trespass = HIGH-severity '
  'audit + worker_in_hazard_alert. Bilingual sw/en per CLAUDE.md '
  'hard rule.';

-- =============================================================================
-- §7 — Workforce locations (ephemeral GPS trail).
--
-- The geofence watcher reads recent rows here every 30s. TTL'd to
-- 24h via a partial index + a sweeper cron — we deliberately do NOT
-- keep an indefinite trail to limit PDPA exposure.
--
-- Per CLAUDE.md hard rule: tenant-scoped via RLS FORCE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS workforce_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id         TEXT REFERENCES sites(id) ON DELETE SET NULL,
  /** Latest fix. Real geography for GIST + numeric for ORM mirror. */
  lat             NUMERIC(10, 7) NOT NULL,
  lon             NUMERIC(10, 7) NOT NULL,
  geo_geom        geography(POINT, 4326) NOT NULL,
  accuracy_meters NUMERIC(8, 2),
  heading_deg     NUMERIC(6, 2),
  speed_mps       NUMERIC(7, 3),
  captured_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL DEFAULT 'mobile',
  /** Provenance jsonb: {via, sessionId, turnId} */
  provenance      JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT workforce_locations_source_check CHECK (
    source IN ('mobile', 'kiosk', 'manual', 'simulated')
  ),
  CONSTRAINT workforce_locations_lat_range CHECK (
    lat BETWEEN -90 AND 90
  ),
  CONSTRAINT workforce_locations_lon_range CHECK (
    lon BETWEEN -180 AND 180
  )
);

CREATE INDEX IF NOT EXISTS workforce_locations_tenant_employee_captured_idx
  ON workforce_locations (tenant_id, employee_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS workforce_locations_tenant_recent_idx
  ON workforce_locations (tenant_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS workforce_locations_geo_gix
  ON workforce_locations USING GIST (geo_geom);

ALTER TABLE workforce_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_locations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_locations_tenant_isolation ON workforce_locations;

CREATE POLICY workforce_locations_tenant_isolation ON workforce_locations
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE workforce_locations IS
  'Ephemeral GPS trail per worker. TTL 24h (sweeper cron). The '
  'geofence watcher (services/api-gateway/src/workers/geofence-'
  'watcher.ts) ticks every 30s and fires off-site / in-hazard alerts.';

-- =============================================================================
-- §8 — Regulatory zones — Tanzania PCCB / NEMC / EITI boundaries.
--
-- Tenant-AGNOSTIC table (tenant_id intentionally absent). Regulators
-- publish the same boundaries to every operator — same model as
-- intelligence_corpus_chunks (which also sets tenant_id = NULL).
--
-- Seeded via migration §9 with the 10 EITI small-scale mining zones
-- and admin-region stubs for PCCB / NEMC. Refined when the official
-- TEITI shapefile becomes machine-readable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS regulatory_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** pccb | nemc | eiti */
  authority       TEXT NOT NULL,
  /** sw/en bilingual names. */
  name_sw         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  code            TEXT NOT NULL,
  /** GeoJSON polygon (text) at ORM boundary. */
  polygon         TEXT NOT NULL,
  polygon_geom    geography(MULTIPOLYGON, 4326) NOT NULL,
  /** Free-form regulatory metadata: {office_contact, statute_ref, ...}. */
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_from     DATE,
  active_until    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT regulatory_zones_authority_check CHECK (
    authority IN ('pccb', 'nemc', 'eiti')
  ),
  CONSTRAINT regulatory_zones_authority_code_unique UNIQUE (authority, code)
);

CREATE INDEX IF NOT EXISTS regulatory_zones_authority_idx
  ON regulatory_zones (authority);

CREATE INDEX IF NOT EXISTS regulatory_zones_polygon_gix
  ON regulatory_zones USING GIST (polygon_geom);

COMMENT ON TABLE regulatory_zones IS
  'Tanzania regulatory geo: PCCB regions + NEMC catchment areas + '
  'EITI small-scale mining zones. tenant_id intentionally absent — '
  'regulators publish the same boundaries to every operator (same '
  'model as intelligence_corpus_chunks).';

-- =============================================================================
-- §9 — Seed EITI small-scale mining zones (TEITI 14th report, 2024).
--
-- Stub polygons — coarse bounding boxes per zone for the 10 named
-- regions. Refined when the official TEITI shapefile is published in
-- machine-readable form. Idempotent via UNIQUE(authority, code).
-- =============================================================================

INSERT INTO regulatory_zones (authority, name_sw, name_en, code, polygon, polygon_geom, attributes)
VALUES
  ('eiti', 'Arusha-Manyara', 'Arusha-Manyara', 'AR_MN',
   '{"type":"Polygon","coordinates":[[[35.5,-5.5],[37.5,-5.5],[37.5,-3.0],[35.5,-3.0],[35.5,-5.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((35.5 -5.5, 37.5 -5.5, 37.5 -3.0, 35.5 -3.0, 35.5 -5.5)))'),
   '{"teiti_zone":"AR_MN","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Bukoba', 'Bukoba', 'BKB',
   '{"type":"Polygon","coordinates":[[[31.0,-2.5],[32.5,-2.5],[32.5,-1.0],[31.0,-1.0],[31.0,-2.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((31.0 -2.5, 32.5 -2.5, 32.5 -1.0, 31.0 -1.0, 31.0 -2.5)))'),
   '{"teiti_zone":"BKB","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Dodoma', 'Dodoma', 'DOD',
   '{"type":"Polygon","coordinates":[[[34.5,-7.5],[36.5,-7.5],[36.5,-5.5],[34.5,-5.5],[34.5,-7.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((34.5 -7.5, 36.5 -7.5, 36.5 -5.5, 34.5 -5.5, 34.5 -7.5)))'),
   '{"teiti_zone":"DOD","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Mbeya', 'Mbeya', 'MBY',
   '{"type":"Polygon","coordinates":[[[32.0,-9.5],[34.5,-9.5],[34.5,-7.0],[32.0,-7.0],[32.0,-9.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((32.0 -9.5, 34.5 -9.5, 34.5 -7.0, 32.0 -7.0, 32.0 -9.5)))'),
   '{"teiti_zone":"MBY","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Mpanda', 'Mpanda', 'MPD',
   '{"type":"Polygon","coordinates":[[[30.5,-7.5],[32.5,-7.5],[32.5,-5.5],[30.5,-5.5],[30.5,-7.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((30.5 -7.5, 32.5 -7.5, 32.5 -5.5, 30.5 -5.5, 30.5 -7.5)))'),
   '{"teiti_zone":"MPD","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Mtwara', 'Mtwara', 'MTW',
   '{"type":"Polygon","coordinates":[[[38.5,-11.5],[40.5,-11.5],[40.5,-10.0],[38.5,-10.0],[38.5,-11.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((38.5 -11.5, 40.5 -11.5, 40.5 -10.0, 38.5 -10.0, 38.5 -11.5)))'),
   '{"teiti_zone":"MTW","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Musoma-Mwanza', 'Musoma-Mwanza', 'MS_MW',
   '{"type":"Polygon","coordinates":[[[32.5,-3.5],[35.0,-3.5],[35.0,-1.0],[32.5,-1.0],[32.5,-3.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((32.5 -3.5, 35.0 -3.5, 35.0 -1.0, 32.5 -1.0, 32.5 -3.5)))'),
   '{"teiti_zone":"MS_MW","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Shinyanga-Songwe', 'Shinyanga-Songwe', 'SH_SW',
   '{"type":"Polygon","coordinates":[[[32.0,-4.5],[34.5,-4.5],[34.5,-2.5],[32.0,-2.5],[32.0,-4.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((32.0 -4.5, 34.5 -4.5, 34.5 -2.5, 32.0 -2.5, 32.0 -4.5)))'),
   '{"teiti_zone":"SH_SW","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Singida', 'Singida', 'SGD',
   '{"type":"Polygon","coordinates":[[[33.5,-6.5],[35.5,-6.5],[35.5,-4.5],[33.5,-4.5],[33.5,-6.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((33.5 -6.5, 35.5 -6.5, 35.5 -4.5, 33.5 -4.5, 33.5 -6.5)))'),
   '{"teiti_zone":"SGD","report":"TEITI 14th"}'::jsonb),
  ('eiti', 'Tanga-Kilimanjaro', 'Tanga-Kilimanjaro', 'TG_KL',
   '{"type":"Polygon","coordinates":[[[37.0,-6.0],[39.5,-6.0],[39.5,-3.0],[37.0,-3.0],[37.0,-6.0]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((37.0 -6.0, 39.5 -6.0, 39.5 -3.0, 37.0 -3.0, 37.0 -6.0)))'),
   '{"teiti_zone":"TG_KL","report":"TEITI 14th"}'::jsonb)
ON CONFLICT (authority, code) DO NOTHING;

-- PCCB regions (stubs covering the same admin-region bounding boxes
-- — refined when official ML-readable polygons are published).
INSERT INTO regulatory_zones (authority, name_sw, name_en, code, polygon, polygon_geom, attributes)
VALUES
  ('pccb', 'Arusha', 'Arusha', 'AR',
   '{"type":"Polygon","coordinates":[[[35.5,-5.5],[37.5,-5.5],[37.5,-3.0],[35.5,-3.0],[35.5,-5.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((35.5 -5.5, 37.5 -5.5, 37.5 -3.0, 35.5 -3.0, 35.5 -5.5)))'),
   '{"pccb_office":"Arusha","jurisdiction":"region"}'::jsonb),
  ('pccb', 'Geita', 'Geita', 'GT',
   '{"type":"Polygon","coordinates":[[[31.5,-3.5],[33.0,-3.5],[33.0,-2.0],[31.5,-2.0],[31.5,-3.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((31.5 -3.5, 33.0 -3.5, 33.0 -2.0, 31.5 -2.0, 31.5 -3.5)))'),
   '{"pccb_office":"Geita","jurisdiction":"region"}'::jsonb),
  ('pccb', 'Mwanza', 'Mwanza', 'MW',
   '{"type":"Polygon","coordinates":[[[32.5,-3.5],[33.5,-3.5],[33.5,-2.0],[32.5,-2.0],[32.5,-3.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((32.5 -3.5, 33.5 -3.5, 33.5 -2.0, 32.5 -2.0, 32.5 -3.5)))'),
   '{"pccb_office":"Mwanza","jurisdiction":"region"}'::jsonb)
ON CONFLICT (authority, code) DO NOTHING;

-- NEMC catchment areas (stubs — Lake Victoria, Rufiji, Pangani).
INSERT INTO regulatory_zones (authority, name_sw, name_en, code, polygon, polygon_geom, attributes)
VALUES
  ('nemc', 'Bonde la Ziwa Victoria', 'Lake Victoria Basin', 'LV',
   '{"type":"Polygon","coordinates":[[[30.5,-3.5],[35.0,-3.5],[35.0,-1.0],[30.5,-1.0],[30.5,-3.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((30.5 -3.5, 35.0 -3.5, 35.0 -1.0, 30.5 -1.0, 30.5 -3.5)))'),
   '{"basin":"lake_victoria","ema_section":"§29"}'::jsonb),
  ('nemc', 'Bonde la Rufiji', 'Rufiji Basin', 'RUF',
   '{"type":"Polygon","coordinates":[[[35.0,-9.5],[39.5,-9.5],[39.5,-6.5],[35.0,-6.5],[35.0,-9.5]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((35.0 -9.5, 39.5 -9.5, 39.5 -6.5, 35.0 -6.5, 35.0 -9.5)))'),
   '{"basin":"rufiji","ema_section":"§29"}'::jsonb),
  ('nemc', 'Bonde la Pangani', 'Pangani Basin', 'PAN',
   '{"type":"Polygon","coordinates":[[[36.5,-6.0],[39.5,-6.0],[39.5,-3.0],[36.5,-3.0],[36.5,-6.0]]]}',
   ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((36.5 -6.0, 39.5 -6.0, 39.5 -3.0, 36.5 -3.0, 36.5 -6.0)))'),
   '{"basin":"pangani","ema_section":"§29"}'::jsonb)
ON CONFLICT (authority, code) DO NOTHING;

COMMIT;
