-- =============================================================================
-- 0251: PostGIS extension install — guard for Piece N geo/parcels.
--
-- PostGIS provides geography/geometry types, spatial indexes (GiST), and
-- ST_* functions that Piece N's land-area + parcel polygon subdivision
-- relies upon. Piece A may have already installed it (`postgis`); this
-- migration is idempotent and also pulls `postgis_topology` for advanced
-- subdivision validation (ST_Within, ST_Intersects on POLYGON children).
--
-- No schema changes here — just ensures the extension is present so the
-- subsequent 0252..0260 migrations can declare `geography(POLYGON, 4326)`
-- columns without failing.
--
-- Operator note: PostgreSQL 14+ + the postgis package must be installed
-- at the cluster level. On Supabase, both extensions are available via
-- the extensions schema; on local docker dev, use
--   `apt install postgresql-14-postgis-3 postgresql-14-postgis-3-scripts`
-- or the official postgis/postgis docker image.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Core PostGIS (idempotent — Piece A may have already installed it).
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. PostGIS topology — needed for advanced subdivision validation
--    (parent/child polygon containment, non-overlap checks).
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Operator-visible sanity comment.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'postgis'
  ) THEN
    RAISE EXCEPTION 'PostGIS extension missing after install attempt; check cluster-level support';
  END IF;
END
$$;
