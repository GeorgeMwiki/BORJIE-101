-- =============================================================================
-- Migration 0026 — Org Hierarchy + Terminology (Wave 18X)
--
-- Companion to docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md. Adds the
-- substrate for multi-level organisational scoping:
--
--   1. org_units                     — recursive tree per tenant. The
--                                       tenant-root pseudo-unit is
--                                       implicit (parent_unit_id NULL
--                                       on top-level rows means "child
--                                       of the tenant root"; the root
--                                       itself is never materialised).
--   2. user_scope_bindings           — many-to-many user × scope:
--                                       tenant_root, org_unit, or
--                                       cross_scope. Carries role +
--                                       authority_tier_max.
--   3. terminology_overrides         — per-tenant + per-org-unit
--                                       override of the default
--                                       terminology catalogue shipped
--                                       in @borjie/org-scope.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. org_units — recursive tree per tenant
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_units (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_unit_id           uuid REFERENCES org_units(id) ON DELETE CASCADE,
  default_kind             text NOT NULL,
  display_name             text NOT NULL,
  display_kind_singular    text NOT NULL,
  display_kind_plural      text NOT NULL,
  materialised_path        text NOT NULL,
  depth                    int  NOT NULL DEFAULT 0,
  authority_inheritance    boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_default_kind_chk CHECK (
    default_kind IN (
      'district','branch','division','department','unit','team','crew','ward',
      'company','region','zone','subsidiary'
    )
  ),
  CONSTRAINT org_units_depth_nonneg_chk CHECK (depth >= 0)
);

CREATE INDEX IF NOT EXISTS org_units_tenant_idx
  ON org_units(tenant_id);
CREATE INDEX IF NOT EXISTS org_units_tenant_path_idx
  ON org_units(tenant_id, materialised_path);
CREATE INDEX IF NOT EXISTS org_units_parent_idx
  ON org_units(parent_unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS org_units_tenant_path_unique_idx
  ON org_units(tenant_id, materialised_path);

-- -----------------------------------------------------------------------------
-- 2. user_scope_bindings — many-to-many user × scope
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_scope_bindings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_kind           text NOT NULL,
  org_unit_id          uuid REFERENCES org_units(id) ON DELETE CASCADE,
  role                 text NOT NULL,
  authority_tier_max   smallint NOT NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  granted_by           text NOT NULL,
  revoked_at           timestamptz,
  CONSTRAINT usb_scope_kind_chk CHECK (
    scope_kind IN ('tenant_root','org_unit','cross_scope')
  ),
  CONSTRAINT usb_tier_range_chk CHECK (authority_tier_max BETWEEN 0 AND 2),
  CONSTRAINT usb_role_chk CHECK (
    role IN ('owner','admin','manager','employee','customer','auditor')
  ),
  CONSTRAINT usb_root_no_unit_chk CHECK (
    (scope_kind = 'tenant_root' AND org_unit_id IS NULL)
    OR (scope_kind <> 'tenant_root' AND org_unit_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS usb_user_tenant_idx
  ON user_scope_bindings(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS usb_scope_idx
  ON user_scope_bindings(tenant_id, org_unit_id);
CREATE INDEX IF NOT EXISTS usb_active_idx
  ON user_scope_bindings(tenant_id, user_id)
  WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. terminology_overrides — per-tenant + per-org-unit overrides
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS terminology_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_unit_id       uuid REFERENCES org_units(id) ON DELETE CASCADE,
  key               text NOT NULL,
  singular_en       text NOT NULL,
  plural_en         text NOT NULL,
  singular_sw       text,
  plural_sw         text,
  overridden_by     text NOT NULL,
  overridden_at     timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness: one row per (tenant, org_unit, key). The COALESCE
-- sentinel keeps tenant-wide rows (org_unit_id IS NULL) distinct from
-- org-unit-scoped rows for the same key.
CREATE UNIQUE INDEX IF NOT EXISTS terminology_overrides_unique_idx
  ON terminology_overrides (
    tenant_id,
    COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key
  );
CREATE INDEX IF NOT EXISTS terminology_overrides_tenant_key_idx
  ON terminology_overrides(tenant_id, key);

-- -----------------------------------------------------------------------------
-- 4. Row Level Security — all three tables tenant-scoped
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_units',
    'user_scope_bindings',
    'terminology_overrides'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0026_org_scope_hierarchy.sql
-- =============================================================================
