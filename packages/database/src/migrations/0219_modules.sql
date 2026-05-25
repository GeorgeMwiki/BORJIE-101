-- =============================================================================
-- 0216: modules — Piece B per-tenant module instances.
--
-- A module is a tenant-spawned, vertical slice of functionality
-- ("HR", "Estate", "Fleet") that owns:
--   * its own slice of `core_entity` (filtered by `module_id`)
--   * its own UI sections (`ui_layout_jsonb` drives the adaptive engine)
--   * a vector namespace for module-scoped retrieval
--   * a scoped tool catalogue (which kernel tools the brain may call)
--   * a lifecycle state machine: DRAFT → PROPOSED → APPROVED → LIVE
--     → DEPRECATED → ARCHIVED. The transition into LIVE is K5-gated
--     (`hitl_approval_id` references `approval_policy_actions`).
--
-- Each row is a *concrete instance* of a `module_template` (0218).
-- One tenant can have many modules built from the same template
-- (e.g. "HR — Head Office" + "HR — Subsidiary") provided their slugs
-- differ.
--
-- See `Docs/architecture/PIECE_L_BRAIN_TAB_LOOP.md` §3-§4 for how
-- `module_id` is the JOIN key that lets the dispatcher fan a capture
-- to the right tab.
--
-- Idempotent. All operations gated on object existence. Safe to re-run.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create modules table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS modules (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  title_sw              TEXT,
  -- FK references intentionally NOT declared inline; module_templates
  -- and module_specs are created in 0218 and 0217 respectively, both
  -- AFTER this migration. The FKs are added at the end of 0218 once
  -- both target tables exist.
  template_id           TEXT,
  spec_id               TEXT,
  ui_layout_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
  vector_namespace      TEXT NOT NULL,
  scoped_tool_ids       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  audit_chain_root      TEXT,
  lifecycle_state       TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_state IN (
      'DRAFT', 'PROPOSED', 'APPROVED', 'LIVE', 'DEPRECATED', 'ARCHIVED'
    )),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at            TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes.
--    * tenant scope (the working index)
--    * (tenant, lifecycle_state) for "live modules for this tenant"
--    * partial unique on (tenant_id, slug) WHERE deleted_at IS NULL
--      so the same slug can be re-used after a soft delete.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS modules_tenant_idx
  ON modules (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS modules_tenant_lifecycle_idx
  ON modules (tenant_id, lifecycle_state)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS modules_tenant_slug_unique
  ON modules (tenant_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS modules_vector_namespace_idx
  ON modules (vector_namespace);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.modules_updated_at_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS modules_updated_at ON modules;
CREATE TRIGGER modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW
  EXECUTE FUNCTION public.modules_updated_at_tg();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Gold-standard RLS (ENABLE + FORCE + REVOKE FROM anon).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'modules'
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

COMMENT ON TABLE modules IS
  'Piece B per-tenant module instance. A vertical slice of functionality '
  '("HR", "Estate", "Fleet") with its own slice of core_entity (filtered '
  'by module_id), its own ui_layout, vector namespace, scoped tool set, '
  'and a lifecycle gated by K5 four-eye on LIVE transition.';

COMMENT ON COLUMN modules.template_id IS
  'FK to module_templates.id, added in 0218 after module_templates exists.';

COMMENT ON COLUMN modules.spec_id IS
  'FK to module_specs.id (current active spec version). Added in 0217 '
  'after module_specs exists.';

COMMENT ON COLUMN modules.vector_namespace IS
  'Format: tnt:{tenant_id}:mod:{module_id}. Bound at insert time; '
  'used by retrieval to keep brain awareness scoped to the module.';

COMMENT ON COLUMN modules.scoped_tool_ids IS
  'Whitelist of kernel tool ids the brain may invoke while operating '
  'inside this module. Filtered by the persona-runtime tool-catalog.';

COMMENT ON COLUMN modules.lifecycle_state IS
  'State machine: DRAFT (created) → PROPOSED (spec compiled, awaiting '
  'approval) → APPROVED (passed K5 four-eye) → LIVE (migration applied) '
  '→ DEPRECATED → ARCHIVED. The PROPOSED→APPROVED edge is the only '
  'transition that requires hitl_approval_id (held on module_specs row).';
