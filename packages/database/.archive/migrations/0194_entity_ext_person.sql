-- =============================================================================
-- 0194: entity_ext_person — thin extension table for PERSON entities,
--       PLUS the backward-compat union views properties_view and
--       units_view.
--
-- Three parts:
--
--   1. `entity_ext_person` table — supabase user link, email/phone,
--      Tanzania NIDA, name, preferred language.
--
--   2. `properties_view` — UNION ALL of:
--        * legacy `properties` table (untouched)
--        * core_entity rows of type BUILDING / WAREHOUSE / GODOWN /
--          HOTEL via entity_ext_building (acts as the new "property"
--          shape with a stable column mapping).
--      Existing `SELECT * FROM properties` callers keep working
--      because we only ADD a sibling view; the legacy table is
--      unmodified. Apps that want the unified surface read from
--      properties_view.
--
--   3. `units_view` — UNION ALL of:
--        * legacy `units` table (untouched)
--        * core_entity rows of type SUB_UNIT via entity_ext_building
--          on the parent.
--
-- Tenant-scoped via RLS on the underlying tables; the view inherits
-- the policies of its source tables (Postgres views with security_invoker=true).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. entity_ext_person table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_ext_person (
  entity_id            TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /**
   * Link to Supabase auth.users(id). NULL when the PERSON is not a
   * platform login (e.g. visitor records, dependants, contacts).
   */
  supabase_user_id     TEXT,
  email                TEXT,
  phone                TEXT,
  /** Tanzania National Identification Authority number. */
  nida_number          TEXT,
  first_name           TEXT,
  last_name            TEXT,
  preferred_language   TEXT NOT NULL DEFAULT 'en',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_person_tenant_idx
  ON entity_ext_person (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_person_supabase_idx
  ON entity_ext_person (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_person_email_uidx
  ON entity_ext_person (tenant_id, email)
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_person_phone_uidx
  ON entity_ext_person (tenant_id, phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_person_nida_uidx
  ON entity_ext_person (tenant_id, nida_number)
  WHERE nida_number IS NOT NULL;

-- RLS
ALTER TABLE entity_ext_person ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_person FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_person;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_person;

CREATE POLICY tenant_isolation_select ON entity_ext_person
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_person
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_person FROM anon;

COMMENT ON TABLE entity_ext_person IS
  'Thin extension for PERSON entities. supabase_user_id is NULL for '
  'PERSON records that are not platform logins (visitor logs, contact '
  'rolodex, dependants). preferred_language drives downstream i18n; '
  'platform pilot supports en + sw natively, others via i18n adapters.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. properties_view — UNION ALL of legacy properties + BUILDING-flavoured
--    core_entity rows. Stable column shape; columns absent on one side
--    fall back to NULL on that branch.
-- ─────────────────────────────────────────────────────────────────────────

-- Drop the view if it exists with the wrong shape; we recreate every
-- time so column additions in the future stay clean.
DROP VIEW IF EXISTS properties_view CASCADE;

CREATE VIEW properties_view
WITH (security_invoker = true)
AS
  -- Legacy `properties` table — untouched.
  SELECT
    p.id::text                                                         AS id,
    p.tenant_id::text                                                  AS tenant_id,
    p.property_code                                                    AS code,
    p.name                                                             AS display_name,
    p.type::text                                                       AS legacy_type,
    NULL::text                                                         AS entity_type,
    p.status::text                                                     AS lifecycle_state,
    p.address_line1                                                    AS address_line1,
    p.address_line2                                                    AS address_line2,
    p.city                                                             AS city,
    p.state                                                            AS state,
    p.postal_code                                                      AS postal_code,
    p.country                                                          AS country,
    p.year_built::smallint                                             AS year_built,
    p.total_units                                                      AS total_units,
    NULL::numeric                                                      AS square_meters,
    NULL::text                                                         AS building_type,
    'legacy'::text                                                     AS source,
    p.created_at                                                       AS created_at,
    p.updated_at                                                       AS updated_at,
    p.deleted_at                                                       AS deleted_at
  FROM properties p

  UNION ALL

  -- New BUILDING-flavoured core_entity rows.
  SELECT
    ce.id                                                              AS id,
    ce.tenant_id                                                       AS tenant_id,
    NULL::text                                                         AS code,
    ce.display_name                                                    AS display_name,
    NULL::text                                                         AS legacy_type,
    ce.entity_type                                                     AS entity_type,
    ce.lifecycle_state                                                 AS lifecycle_state,
    (ce.custom_fields ->> 'address_line1')                             AS address_line1,
    (ce.custom_fields ->> 'address_line2')                             AS address_line2,
    (ce.custom_fields ->> 'city')                                      AS city,
    (ce.custom_fields ->> 'state')                                     AS state,
    (ce.custom_fields ->> 'postal_code')                               AS postal_code,
    (ce.custom_fields ->> 'country')                                   AS country,
    eb.year_built                                                      AS year_built,
    NULL::integer                                                      AS total_units,
    eb.square_meters                                                   AS square_meters,
    eb.building_type                                                   AS building_type,
    'core_entity'::text                                                AS source,
    ce.created_at                                                      AS created_at,
    ce.updated_at                                                      AS updated_at,
    ce.deleted_at                                                      AS deleted_at
  FROM core_entity ce
  LEFT JOIN entity_ext_building eb ON eb.entity_id = ce.id
  WHERE ce.entity_type IN ('BUILDING', 'WAREHOUSE', 'GODOWN', 'HOTEL');

COMMENT ON VIEW properties_view IS
  'Backward-compat union view: legacy properties + BUILDING-flavoured '
  'core_entity rows. security_invoker=true so the view honours the RLS '
  'policies of the underlying tables (no privilege escalation).';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. units_view — UNION ALL of legacy units + SUB_UNIT core_entity rows.
-- ─────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS units_view CASCADE;

CREATE VIEW units_view
WITH (security_invoker = true)
AS
  -- Legacy `units` table — untouched.
  SELECT
    u.id::text                                                         AS id,
    u.tenant_id::text                                                  AS tenant_id,
    u.property_id::text                                                AS parent_id,
    u.unit_code                                                        AS code,
    u.name                                                             AS display_name,
    u.type::text                                                       AS legacy_type,
    NULL::text                                                         AS entity_type,
    u.status::text                                                     AS lifecycle_state,
    u.floor                                                            AS floor,
    u.square_meters                                                    AS square_meters,
    u.bedrooms                                                         AS bedrooms,
    u.base_rent_amount                                                 AS base_rent_amount,
    u.base_rent_currency                                               AS base_rent_currency,
    'legacy'::text                                                     AS source,
    u.created_at                                                       AS created_at,
    u.updated_at                                                       AS updated_at,
    u.deleted_at                                                       AS deleted_at
  FROM units u

  UNION ALL

  -- New SUB_UNIT-flavoured core_entity rows.
  SELECT
    ce.id                                                              AS id,
    ce.tenant_id                                                       AS tenant_id,
    ce.parent_entity_id                                                AS parent_id,
    NULL::text                                                         AS code,
    ce.display_name                                                    AS display_name,
    NULL::text                                                         AS legacy_type,
    ce.entity_type                                                     AS entity_type,
    ce.lifecycle_state                                                 AS lifecycle_state,
    NULLIF(ce.custom_fields ->> 'floor', '')::integer                  AS floor,
    NULLIF(ce.custom_fields ->> 'square_meters', '')::numeric          AS square_meters,
    NULLIF(ce.custom_fields ->> 'bedrooms', '')::integer               AS bedrooms,
    NULLIF(ce.custom_fields ->> 'base_rent_amount', '')::integer       AS base_rent_amount,
    (ce.custom_fields ->> 'base_rent_currency')                        AS base_rent_currency,
    'core_entity'::text                                                AS source,
    ce.created_at                                                      AS created_at,
    ce.updated_at                                                      AS updated_at,
    ce.deleted_at                                                      AS deleted_at
  FROM core_entity ce
  WHERE ce.entity_type = 'SUB_UNIT';

COMMENT ON VIEW units_view IS
  'Backward-compat union view: legacy units + SUB_UNIT core_entity rows. '
  'security_invoker=true so the view honours RLS of the underlying tables.';

-- ─────────────────────────────────────────────────────────────────────────
-- Operator note:
--
--   Existing callers `SELECT * FROM properties` and
--   `SELECT * FROM units` continue to work because we only added
--   `*_view` siblings. New code that wants the unified surface should
--   read from properties_view / units_view. Once every reader has been
--   migrated, the legacy tables can be retired in a separate piece —
--   but that's NOT this migration's job.
--
--   Postgres treats `security_invoker = true` views as filtering rows
--   through the calling role's RLS, which is the correct semantic
--   here: an authenticated user querying properties_view sees rows
--   from their own tenant only, both from the legacy table and from
--   core_entity.
-- ─────────────────────────────────────────────────────────────────────────
