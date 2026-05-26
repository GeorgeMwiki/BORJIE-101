-- =============================================================================
-- 0188: tenant_schema_extensions — typed custom-field definitions.
--
-- The piece that closes the "tenant-defined custom fields with NO DDL"
-- promise. For each (tenant_id, module_id, entity_type, field_name)
-- tuple, the tenant admin registers:
--
--   * `field_kind`     — primitive shape (text / number / money / date / ...).
--   * `zod_jsonb`      — Zod schema serialized to JSONB (parsed by the
--                        repository at write time to validate the
--                        incoming custom_fields blob).
--   * `validations_jsonb` — extra constraints (regex, min/max, enum
--                        values) for forms.
--   * `index_strategy` — optional hint for the migration generator:
--                        `gin_path` (functional GIN on the path) or
--                        `btree_path` (functional B-tree).
--
-- This table is the SINGLE source of truth for what tenants are
-- allowed to write into `core_entity.custom_fields`. The repository
-- never bypasses it.
--
-- Rows are tenant-scoped via RLS. A platform-tier row (tenant_id IS
-- NULL) defines a custom field globally available to every tenant —
-- used sparingly for cross-tenant fields like an industry-standard
-- "asbestos_present" boolean.
--
-- Idempotent + safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_schema_extensions (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  module_id           TEXT,
  entity_type         TEXT NOT NULL,
  field_name          TEXT NOT NULL,
  /**
   * Allowed values: 'text' | 'number' | 'money' | 'date' | 'datetime'
   *                | 'boolean' | 'enum' | 'ref' | 'jsonb' | 'vector'.
   * Stored as free-form TEXT for forward-compat with new kinds.
   */
  field_kind          TEXT NOT NULL,
  /**
   * Zod schema serialized via @borjie/domain-models zodToJson
   * helper. The repository deserialises this back into a Zod
   * validator and parses the incoming JSONB blob.
   */
  zod_jsonb           JSONB NOT NULL,
  required            BOOLEAN NOT NULL DEFAULT FALSE,
  /**
   * Optional: 'gin_path' | 'btree_path' | NULL. Hints the migration
   * generator to add a functional index on the JSONB path. NULL means
   * no index (the table-wide jsonb_path_ops GIN on custom_fields
   * still covers contains queries).
   */
  index_strategy      TEXT,
  /**
   * Free-form JSONB array of validation rules — regex patterns, min/
   * max, enum values, refs to other entity types. Used by the form
   * generator and the repository at write time.
   */
  validations_jsonb   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** UI hint — display order in forms (NULL = appended). */
  display_order       INTEGER,
  /** UI hint — human-readable label (defaults to field_name). */
  display_label_en    TEXT,
  display_label_sw    TEXT,
  /** UI hint — helper text below the field. */
  help_text           TEXT,
  /** UI hint — placeholder. */
  placeholder         TEXT,
  /** Allow tenant to soft-delete the extension without losing audit. */
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT
);

-- Uniqueness: (tenant_id, module_id, entity_type, field_name).
-- Treat NULL tenant_id (platform) + NULL module_id as a single key via
-- COALESCE in the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_schema_extensions_uidx
  ON tenant_schema_extensions (
    COALESCE(tenant_id, '__platform__'),
    COALESCE(module_id, '__no_module__'),
    entity_type,
    field_name
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_schema_extensions_tenant_idx
  ON tenant_schema_extensions (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_schema_extensions_type_idx
  ON tenant_schema_extensions (tenant_id, entity_type)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — gold-standard pattern, with the platform-tier read carve-out
-- (rows where tenant_id IS NULL are visible to every authenticated
-- user but only mutable by service-role).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_schema_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_schema_extensions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_schema_extensions_select ON tenant_schema_extensions;
DROP POLICY IF EXISTS tenant_schema_extensions_modify ON tenant_schema_extensions;

CREATE POLICY tenant_schema_extensions_select ON tenant_schema_extensions
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id = public.current_app_tenant_id()
  );

CREATE POLICY tenant_schema_extensions_modify ON tenant_schema_extensions
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON tenant_schema_extensions FROM anon;

-- ─────────────────────────────────────────────────────────────────────────
-- Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE tenant_schema_extensions IS
  'Per-(tenant, module, entity_type) custom-field catalog. The single '
  'source of truth for what may appear in core_entity.custom_fields. '
  'Repository validates incoming custom_fields against zod_jsonb at write '
  'time. No DDL needed when a tenant defines a new field — purely a row '
  'insert here.';

COMMENT ON COLUMN tenant_schema_extensions.field_kind IS
  'Primitive shape — text / number / money / date / datetime / boolean / '
  'enum / ref / jsonb / vector. Drives the form widget and the Zod '
  'unwrapping. ref means a foreign reference to another core_entity by id.';

COMMENT ON COLUMN tenant_schema_extensions.zod_jsonb IS
  'Zod schema serialized via @borjie/domain-models. The repository '
  'rehydrates a Zod validator and runs custom_fields[field_name] through '
  'it on every insert/update.';

COMMENT ON COLUMN tenant_schema_extensions.index_strategy IS
  'Optional. Tells the migration generator how to index this path: '
  '"gin_path" → functional GIN on (custom_fields -> field_name); '
  '"btree_path" → functional B-tree on (custom_fields ->> field_name).';
