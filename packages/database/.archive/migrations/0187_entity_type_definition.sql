-- @safety: dynamic-not-null-reviewed
-- Reviewed 2026-05-25: the single `EXECUTE 'ALTER TABLE
-- entity_type_definition ALTER COLUMN id SET NOT NULL'` runs inside an
-- idempotent DO block guarded by `IF NOT EXISTS (... column 'id')`. The
-- preceding EXECUTE statements in the same block (a) add the column,
-- (b) backfill every existing row via the UPDATE on lines 73-77, and
-- only THEN set NOT NULL. This is the HAS_BACKFILL pattern the static
-- analyser already classifies as safe; the dynamic indirection exists
-- to keep the migration re-runnable against partially-applied DBs.
-- =============================================================================
-- 0187: entity_type_definition — type catalog for the universal asset model.
--
-- Two-layer catalog:
--
--   * PLATFORM built-ins (`is_built_in = TRUE`, `tenant_id IS NULL`) —
--     the canonical type slugs every tenant inherits (LAND_PARCEL,
--     BUILDING, SUB_UNIT, VEHICLE, MACHINERY, IT_ASSET, INTANGIBLE,
--     PERSON, ORG_UNIT, VENDOR, CONTRACT, etc.).
--
--   * TENANT-defined (`tenant_id IS NOT NULL`) — bespoke types added by
--     a tenant admin from the console (e.g. "FERMENTATION_TANK" for a
--     brewery, "MOORING" for a marina). The slug is unique per
--     (tenant_id, slug) so two tenants can both define "MOORING"
--     independently.
--
-- This migration:
--   1. Creates the `entity_type_definition` table.
--   2. Backfills the platform built-in types (idempotent via ON CONFLICT
--      DO NOTHING).
--   3. Adds the FK from core_entity.entity_type → entity_type_definition.slug
--      (now safe to add because the targeted slugs exist).
--   4. Installs RLS: platform-tier rows readable by all authenticated
--      users; tenant-tier rows visible only to their owning tenant.
--
-- Idempotent: ON CONFLICT DO NOTHING on every seed row; ALTER TABLE
-- gated on constraint absence.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the type catalog table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_type_definition (
  slug                 TEXT NOT NULL,
  tenant_id            TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  display_name_en      TEXT NOT NULL,
  display_name_sw      TEXT,
  description          TEXT,
  is_built_in          BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_parent_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  icon                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slug, COALESCE(tenant_id, ''))
);

-- Drop the composite PK if it exists with the wrong shape and re-add
-- as a unique constraint (a composite PK with COALESCE-in-key is not
-- legal in pre-15 Postgres; use unique index instead).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'entity_type_definition'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    EXECUTE 'ALTER TABLE entity_type_definition DROP CONSTRAINT entity_type_definition_pkey';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'entity_type_definition PK drop skipped: %', SQLERRM;
END
$$;

-- Use a surrogate PK + unique constraint on (slug, tenant_id_or_empty).
-- Add the surrogate id column only if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entity_type_definition' AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE entity_type_definition ADD COLUMN id TEXT';
    EXECUTE $upd$
      UPDATE entity_type_definition
      SET id = slug || ':' || COALESCE(tenant_id, '__platform__')
      WHERE id IS NULL
    $upd$;
    EXECUTE 'ALTER TABLE entity_type_definition ALTER COLUMN id SET NOT NULL';
    EXECUTE 'ALTER TABLE entity_type_definition ADD PRIMARY KEY (id)';
  END IF;
END
$$;

-- Unique constraint for the (slug, tenant_id) identity. Use a partial
-- unique index instead of a UNIQUE constraint because NULL tenant_id
-- must be treated as a single value (the platform row).
CREATE UNIQUE INDEX IF NOT EXISTS entity_type_definition_platform_slug_uidx
  ON entity_type_definition (slug)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_type_definition_tenant_slug_uidx
  ON entity_type_definition (tenant_id, slug)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entity_type_definition_tenant_idx
  ON entity_type_definition (tenant_id);

CREATE INDEX IF NOT EXISTS entity_type_definition_built_in_idx
  ON entity_type_definition (is_built_in)
  WHERE is_built_in = TRUE;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Seed platform built-in types. All idempotent via ON CONFLICT
--    DO NOTHING on the (slug, NULL tenant_id) unique index.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO entity_type_definition (
  id, slug, tenant_id, display_name_en, display_name_sw, description,
  is_built_in, allowed_parent_types, icon
) VALUES
  ('LAND_PARCEL:__platform__', 'LAND_PARCEL', NULL,
   'Land Parcel', 'Kipande cha Ardhi',
   'A single titled or surveyed parcel of land. Can be subdivided '
   'via parent_entity_id into sub-parcels.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'land'),

  ('BUILDING:__platform__', 'BUILDING', NULL,
   'Building', 'Jengo',
   'A physical building. Children are SUB_UNITs (rooms, suites, '
   'retail bays). Parent is optionally a LAND_PARCEL.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'building'),

  ('SUB_UNIT:__platform__', 'SUB_UNIT', NULL,
   'Sub-Unit', 'Chumba',
   'A sub-unit within a building — apartment, suite, retail bay, '
   'office, storage cubicle. Parent is BUILDING.',
   TRUE, ARRAY['BUILDING']::TEXT[], 'door'),

  ('WAREHOUSE:__platform__', 'WAREHOUSE', NULL,
   'Warehouse', 'Bohari',
   'Industrial storage building. Discriminator value for BUILDING '
   '(use BUILDING with discriminator="warehouse") or a standalone '
   'type for tenants who never need building-level grouping.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'warehouse'),

  ('GODOWN:__platform__', 'GODOWN', NULL,
   'Godown', 'Ghala',
   'Bulk storage facility. Common in East African commercial '
   'estates; semantically distinct from WAREHOUSE for tenants who '
   'differentiate.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'godown'),

  ('HOTEL:__platform__', 'HOTEL', NULL,
   'Hotel', 'Hoteli',
   'Hospitality building. Sub-units are rooms. Discriminator may '
   'carry the star rating.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'hotel'),

  ('PLOT:__platform__', 'PLOT', NULL,
   'Plot', 'Kiwanja',
   'Developed plot — subset of LAND_PARCEL after subdivision; '
   'distinct slug for tenants whose workflows separate undeveloped '
   'BARELAND from PLOT-ready land.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'plot'),

  ('BARELAND:__platform__', 'BARELAND', NULL,
   'Bareland', 'Ardhi Tupu',
   'Undeveloped land. No buildings yet. Useful as a separate '
   'discriminator when forecasting development upside.',
   TRUE, ARRAY['LAND_PARCEL']::TEXT[], 'bareland'),

  ('VEHICLE:__platform__', 'VEHICLE', NULL,
   'Vehicle', 'Gari',
   'Any roadworthy or rail-worthy vehicle. See entity_ext_vehicle '
   'for VIN / plate / make / model.',
   TRUE, ARRAY[]::TEXT[], 'vehicle'),

  ('LOCOMOTIVE:__platform__', 'LOCOMOTIVE', NULL,
   'Locomotive', 'Loko',
   'Rail vehicle. Discriminator may carry locomotive class '
   '(diesel, electric, steam-heritage).',
   TRUE, ARRAY[]::TEXT[], 'locomotive'),

  ('MACHINERY:__platform__', 'MACHINERY', NULL,
   'Machinery', 'Mashine',
   'Plant and machinery. See entity_ext_machinery for serial / '
   'manufacturer / hours-run.',
   TRUE, ARRAY['BUILDING','LAND_PARCEL']::TEXT[], 'gear'),

  ('IT_ASSET:__platform__', 'IT_ASSET', NULL,
   'IT Asset', 'Vifaa vya Teknolojia',
   'Laptop / phone / server / network device. See '
   'entity_ext_it_asset.assigned_to_entity_id for PERSON linkage.',
   TRUE, ARRAY[]::TEXT[], 'laptop'),

  ('INTANGIBLE:__platform__', 'INTANGIBLE', NULL,
   'Intangible Asset', 'Mali Isiyoonekana',
   'Licences, patents, trademarks, brand assets. No physical '
   'location. custom_fields carries the asset-specific metadata.',
   TRUE, ARRAY[]::TEXT[], 'document'),

  ('PERSON:__platform__', 'PERSON', NULL,
   'Person', 'Mtu',
   'A human actor — tenant, owner, staff member, visitor. See '
   'entity_ext_person for email / phone / NIDA / supabase linkage.',
   TRUE, ARRAY['ORG_UNIT']::TEXT[], 'person'),

  ('ORG_UNIT:__platform__', 'ORG_UNIT', NULL,
   'Organizational Unit', 'Kitengo cha Shirika',
   'Department / division / team within the tenant org. Used as '
   'PERSON parent (e.g. employee belongs to engineering team).',
   TRUE, ARRAY['ORG_UNIT']::TEXT[], 'team'),

  ('VENDOR:__platform__', 'VENDOR', NULL,
   'Vendor', 'Muuzaji',
   'External party — supplier, contractor, government agency. '
   'Distinct from PERSON to keep counterparty filtering cheap.',
   TRUE, ARRAY[]::TEXT[], 'vendor'),

  ('CONTRACT:__platform__', 'CONTRACT', NULL,
   'Contract', 'Mkataba',
   'Legal contract — lease, employment, service. INTANGIBLE-flavoured '
   'but worth a top-level type for cross-party search.',
   TRUE, ARRAY[]::TEXT[], 'contract')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Now that the seeded slugs exist, add the FK from core_entity.
--    The FK targets entity_type_definition(slug) — but we need the
--    platform built-ins to satisfy this for tenant-tier rows too, so
--    we use a partial-PK style FK: enforce that core_entity.entity_type
--    matches a slug from either the platform row OR the tenant's own
--    row. Postgres FKs cannot express OR-conditions across partial
--    unique indexes, so we use a CHECK + STATEMENT-level deferrable
--    trigger pattern instead.
--
--    Simplification: enforce only "slug exists somewhere in the
--    catalog" via a per-row trigger. This is lighter than a true FK
--    and is acceptable because the catalog grows monotonically.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.core_entity_type_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entity_type_definition
    WHERE slug = NEW.entity_type
      AND (tenant_id IS NULL OR tenant_id = NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION
      'entity_type %, not found in entity_type_definition for tenant %',
      NEW.entity_type, NEW.tenant_id
      USING ERRCODE = '23503'; -- foreign_key_violation
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS core_entity_type_check_trigger ON core_entity;
CREATE TRIGGER core_entity_type_check_trigger
  BEFORE INSERT OR UPDATE OF entity_type, tenant_id
  ON core_entity
  FOR EACH ROW
  EXECUTE FUNCTION public.core_entity_type_check();

COMMENT ON FUNCTION public.core_entity_type_check IS
  'Validates core_entity.entity_type against entity_type_definition for '
  'both platform built-ins (tenant_id IS NULL) and tenant-defined types '
  '(tenant_id = NEW.tenant_id). Lighter than a true FK because the slug '
  'lookup spans two unique indexes.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS on the type catalog — platform built-ins visible to everyone;
--    tenant-defined types visible only to the owning tenant.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE entity_type_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_type_definition FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS type_def_select ON entity_type_definition;
DROP POLICY IF EXISTS type_def_modify ON entity_type_definition;
DROP POLICY IF EXISTS type_def_modify_platform_protected ON entity_type_definition;

CREATE POLICY type_def_select ON entity_type_definition
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id = public.current_app_tenant_id()
  );

-- Tenants can only INSERT/UPDATE/DELETE rows for their own tenant_id.
-- Platform built-ins are managed only by service-role (which bypasses
-- RLS). The WITH CHECK rejects any write that targets tenant_id IS NULL
-- or another tenant.
CREATE POLICY type_def_modify ON entity_type_definition
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (
    tenant_id = public.current_app_tenant_id()
    AND is_built_in = FALSE
  );

REVOKE ALL ON entity_type_definition FROM anon;

COMMENT ON TABLE entity_type_definition IS
  'Catalog of entity types. Platform built-ins (tenant_id IS NULL, '
  'is_built_in=TRUE) seeded by migration 0187. Tenants may add their own '
  'types via the admin console; tenant rows are RLS-scoped.';

COMMENT ON COLUMN entity_type_definition.allowed_parent_types IS
  'Validation hint: which slugs may appear as parent_entity_id.entity_type '
  'for a row of this type. Empty array = no parent constraint. NOT '
  'enforced by DB — application-layer hint surfaced in the UI.';

COMMENT ON COLUMN entity_type_definition.display_name_sw IS
  'Swahili display name — the platform pilots in Tanzania. Other '
  'languages added via the i18n adapter layer; this column is a '
  'shortcut for the two most-frequent locales.';
