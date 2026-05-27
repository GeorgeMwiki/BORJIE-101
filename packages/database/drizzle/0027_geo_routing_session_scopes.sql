-- =============================================================================
-- Migration 0027 — Customer Geo Routing + Session Scopes (Wave 18Z)
--
-- Implements `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md`.
-- Four tenant-scoped tables back the contract every customer signup
-- and every authenticated session reads from:
--
--   1. customer_locations            — versioned location snapshot per
--                                      customer (current row + audit
--                                      chain history).
--   2. org_unit_service_areas        — geographic territory served by
--                                      each org_unit. Four area kinds:
--                                      polygon | postal_codes |
--                                      station_radius |
--                                      administrative_codes.
--   3. customer_district_assignments — current routing assignment per
--                                      customer (auto_geo |
--                                      customer_override |
--                                      admin_override |
--                                      manual_unassigned). Soft-versioned
--                                      via `active` boolean + paired
--                                      `superseded_at`.
--   4. session_scopes                — companion to the JWT/cookie for
--                                      every authenticated session.
--                                      Carries the active scope id plus
--                                      switch-from history so a
--                                      mid-session scope switch is
--                                      audit-chained.
--
-- All four tables are tenant-scoped via the canonical `app.tenant_id`
-- GUC RLS policy (migration 0003 pattern).
--
-- Idempotent (`IF NOT EXISTS`). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. customer_locations — current location snapshot per customer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_locations (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text          NOT NULL,
  tenant_id           text          NOT NULL,
  source              text          NOT NULL,
  coordinates_lat     numeric(9, 6),
  coordinates_lng     numeric(9, 6),
  postal_code         text,
  administrative_code text,
  city                text,
  recorded_at         timestamptz   NOT NULL DEFAULT now(),
  audit_hash          text          NOT NULL,
  CONSTRAINT customer_locations_source_chk
    CHECK (source IN ('gps', 'postal_code', 'self_declared', 'admin_override')),
  CONSTRAINT customer_locations_lat_range_chk
    CHECK (coordinates_lat IS NULL OR (coordinates_lat >= -90 AND coordinates_lat <= 90)),
  CONSTRAINT customer_locations_lng_range_chk
    CHECK (coordinates_lng IS NULL OR (coordinates_lng >= -180 AND coordinates_lng <= 180))
);

CREATE INDEX IF NOT EXISTS customer_locations_tenant_idx
  ON customer_locations(tenant_id);
CREATE INDEX IF NOT EXISTS customer_locations_customer_idx
  ON customer_locations(tenant_id, customer_id, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 2. org_unit_service_areas — geographic territory per org_unit
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_unit_service_areas (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id           uuid          NOT NULL,
  tenant_id             text          NOT NULL,
  area_kind             text          NOT NULL,
  polygon_geojson       jsonb,
  postal_codes          text[],
  station_lat           numeric(9, 6),
  station_lng           numeric(9, 6),
  station_radius_km     numeric(8, 2),
  administrative_codes  text[],
  priority              integer       NOT NULL DEFAULT 0,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT org_unit_service_areas_kind_chk
    CHECK (area_kind IN ('polygon', 'postal_codes', 'station_radius', 'administrative_codes')),
  CONSTRAINT org_unit_service_areas_radius_chk
    CHECK (station_radius_km IS NULL OR station_radius_km > 0),
  CONSTRAINT org_unit_service_areas_lat_range_chk
    CHECK (station_lat IS NULL OR (station_lat >= -90 AND station_lat <= 90)),
  CONSTRAINT org_unit_service_areas_lng_range_chk
    CHECK (station_lng IS NULL OR (station_lng >= -180 AND station_lng <= 180))
);

CREATE INDEX IF NOT EXISTS org_unit_service_areas_tenant_idx
  ON org_unit_service_areas(tenant_id);
CREATE INDEX IF NOT EXISTS org_unit_service_areas_org_unit_idx
  ON org_unit_service_areas(org_unit_id);
CREATE INDEX IF NOT EXISTS org_unit_service_areas_postal_idx
  ON org_unit_service_areas USING GIN (postal_codes);
CREATE INDEX IF NOT EXISTS org_unit_service_areas_admin_idx
  ON org_unit_service_areas USING GIN (administrative_codes);

-- -----------------------------------------------------------------------------
-- 3. customer_district_assignments — current routing per customer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_district_assignments (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           text          NOT NULL,
  tenant_id             text          NOT NULL,
  assigned_org_unit_id  uuid,
  assignment_kind       text          NOT NULL,
  distance_km           numeric(8, 2),
  reasoning             text          NOT NULL,
  active                boolean       NOT NULL DEFAULT true,
  assigned_at           timestamptz   NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  audit_hash            text          NOT NULL,
  CONSTRAINT customer_district_assignments_kind_chk
    CHECK (assignment_kind IN ('auto_geo', 'customer_override', 'admin_override', 'manual_unassigned'))
);

CREATE INDEX IF NOT EXISTS customer_district_assignments_active_idx
  ON customer_district_assignments(tenant_id, customer_id)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS customer_district_assignments_org_unit_idx
  ON customer_district_assignments(tenant_id, assigned_org_unit_id)
  WHERE active = true;

-- -----------------------------------------------------------------------------
-- 4. session_scopes — companion to JWT/cookie for every session
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS session_scopes (
  session_id              uuid          PRIMARY KEY,
  tenant_id               text          NOT NULL,
  user_id                 text          NOT NULL,
  active_scope_id         uuid,                              -- null = tenant_root
  role_at_active_scope    text          NOT NULL,
  authority_tier_max      smallint      NOT NULL,
  origin                  text          NOT NULL,
  switched_from_scope_id  uuid,
  switched_at             timestamptz,
  audit_hash              text          NOT NULL,
  established_at          timestamptz   NOT NULL DEFAULT now(),
  expires_at              timestamptz   NOT NULL,
  CONSTRAINT session_scopes_origin_chk
    CHECK (origin IN ('auto_single_binding', 'picker_selection', 'mid_session_switch', 'remembered_default')),
  CONSTRAINT session_scopes_tier_chk
    CHECK (authority_tier_max IN (0, 1, 2))
);

CREATE INDEX IF NOT EXISTS session_scopes_user_active_idx
  ON session_scopes(tenant_id, user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS session_scopes_org_unit_idx
  ON session_scopes(tenant_id, active_scope_id)
  WHERE active_scope_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE customer_locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit_service_areas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_district_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_scopes                ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON customer_locations;
CREATE POLICY tenant_isolation ON customer_locations
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON org_unit_service_areas;
CREATE POLICY tenant_isolation ON org_unit_service_areas
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON customer_district_assignments;
CREATE POLICY tenant_isolation ON customer_district_assignments
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON session_scopes;
CREATE POLICY tenant_isolation ON session_scopes
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
