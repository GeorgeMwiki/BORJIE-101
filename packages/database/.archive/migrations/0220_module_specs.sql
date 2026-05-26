-- =============================================================================
-- 0217: module_specs — Piece B versioned module DSL specifications.
--
-- A module_spec is the LLM-generated (or human-authored) JSON spec that
-- describes a module's entities, workflows, and ui_sections. The spec
-- DSL grammar is locked in `packages/module-spec-engine/src/types.ts`
-- and validated via Zod; the LLM may NEVER emit raw SQL/JSX/DDL — only
-- the JSON grammar — and the spec compiler GENERATES safe migration SQL
-- and Zod validators from it.
--
-- Versions are immutable. Each edit creates a new row with version++,
-- compiles fresh migration text, and the module's `spec_id` pointer
-- moves to the new row only after the K5 approval and apply succeed.
--
-- compile_status state machine:
--   pending → compiled → applied
--                ↓
--             failed
--
-- See: Piece B grammar in `packages/module-spec-engine/src/types.ts`.
-- See: Piece A `core_entity` at migration 0186 — generated tables are
--      under-the-hood views over `core_entity` with `module_id` set.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create module_specs table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS module_specs (
  id                          TEXT PRIMARY KEY,
  module_id                   TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version                     SMALLINT NOT NULL CHECK (version >= 1),
  spec_jsonb                  JSONB NOT NULL,
  generated_migration_sql     TEXT,
  generated_zod_validators    JSONB,
  compile_status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (compile_status IN ('pending', 'compiled', 'applied', 'failed')),
  compile_error               TEXT,
  applied_migration_filename  TEXT,
  hitl_approval_id            TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_module_specs_module_version UNIQUE (module_id, version),
  CONSTRAINT ck_module_specs_spec_object CHECK (
    jsonb_typeof(spec_jsonb) = 'object'
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS module_specs_tenant_idx
  ON module_specs (tenant_id);

CREATE INDEX IF NOT EXISTS module_specs_module_version_idx
  ON module_specs (module_id, version DESC);

CREATE INDEX IF NOT EXISTS module_specs_compile_status_idx
  ON module_specs (tenant_id, compile_status);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Now that module_specs exists, add the FK on modules.spec_id.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'modules'
      AND constraint_name = 'modules_spec_id_fkey'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modules'
  ) THEN
    ALTER TABLE modules
      ADD CONSTRAINT modules_spec_id_fkey
      FOREIGN KEY (spec_id)
      REFERENCES module_specs(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Gold-standard RLS.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'module_specs'
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

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE module_specs IS
  'Piece B versioned module DSL specifications. Immutable — each spec '
  'edit creates a new row with version++. spec_jsonb conforms to the '
  'locked grammar in @borjie/module-spec-engine. generated_* fields '
  'are filled by the compiler; compile_status tracks pipeline progress '
  '(pending → compiled → applied; failed is terminal for the row).';

COMMENT ON COLUMN module_specs.spec_jsonb IS
  'The constrained DSL JSON: { entities[], workflows[], ui_sections[] }. '
  'Validated by the spec-engine Zod schema before insert. LLM never '
  'emits SQL/JSX/DDL; the compiler does.';

COMMENT ON COLUMN module_specs.generated_migration_sql IS
  'Safe migration text generated by @borjie/module-spec-engine from '
  'spec_jsonb. Stored verbatim so an auditor can re-apply on disaster '
  'recovery without re-running the compiler.';

COMMENT ON COLUMN module_specs.generated_zod_validators IS
  'JSONB blob mapping entity_slug → serialized Zod schema (kind tree). '
  'Service layer reconstructs runtime Zod schemas from this to validate '
  'CRUD payloads at the module endpoints.';

COMMENT ON COLUMN module_specs.hitl_approval_id IS
  'FK-style reference (TEXT) to approval_policy_actions.id when the '
  'transition into LIVE required K5 four-eye approval. Soft pointer to '
  'avoid forcing approval_policy_actions to load before this migration.';
