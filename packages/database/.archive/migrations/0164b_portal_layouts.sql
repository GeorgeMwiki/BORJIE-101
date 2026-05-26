-- Migration 0164 — Portal layouts (dynamic per-user UI document store).
--
-- Backs the `PortalLayout` Zod schema in `@borjie/genui/document.ts`
-- (research write-up `.audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md`).
-- One row per (tenant, persona, user-or-null) holds the user's
-- persisted portal shape — topbar, sidebar, dashboard cells, primary
-- action, theme, feature flags, accessibility profile.
--
-- Resolution order in the application layer:
--   1. (tenant_id, persona_id, user_id) — the user's own override
--   2. (tenant_id, persona_id, user_id IS NULL) — tenant default
--   3. Persona seed under packages/genui/src/seeds/
--   4. Platform default seed
--
-- Idempotent — every CREATE / ALTER guarded by IF NOT EXISTS / IF EXISTS.

-- ============================================================================
-- 1. Table — portal_layouts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_layouts (
  id                 text        PRIMARY KEY,
  tenant_id          text        NOT NULL,
  persona_id         text        NOT NULL,
  user_id            text,
  schema_version     integer     NOT NULL DEFAULT 1,
  layout             jsonb       NOT NULL,
  parent_layout_id   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Foreign keys
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_tenant_fk'
  ) THEN
    ALTER TABLE public.portal_layouts
      ADD CONSTRAINT portal_layouts_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_parent_fk'
  ) THEN
    ALTER TABLE public.portal_layouts
      ADD CONSTRAINT portal_layouts_parent_fk
        FOREIGN KEY (parent_layout_id) REFERENCES public.portal_layouts(id)
        ON DELETE SET NULL;
  END IF;
END
$$;

-- ============================================================================
-- 3. CHECK constraints — persona enum + version + self-cycle guard
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_persona_chk'
  ) THEN
    ALTER TABLE public.portal_layouts
      ADD CONSTRAINT portal_layouts_persona_chk
        CHECK (persona_id IN (
          'internal_admin', 'property_manager', 'estate_manager',
          'owner', 'customer'
        ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_schema_version_chk'
  ) THEN
    ALTER TABLE public.portal_layouts
      ADD CONSTRAINT portal_layouts_schema_version_chk
        CHECK (schema_version >= 1 AND schema_version <= 9999);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_no_self_parent_chk'
  ) THEN
    ALTER TABLE public.portal_layouts
      ADD CONSTRAINT portal_layouts_no_self_parent_chk
        CHECK (parent_layout_id IS DISTINCT FROM id);
  END IF;
END
$$;

-- ============================================================================
-- 4. Indexes — composite lookup + lineage
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_portal_layouts_tenant_persona_user
  ON public.portal_layouts (tenant_id, persona_id, user_id);

CREATE INDEX IF NOT EXISTS idx_portal_layouts_parent
  ON public.portal_layouts (parent_layout_id);

-- Single-default-per-(tenant, persona) where user_id IS NULL — partial
-- unique. The Drizzle schema also declares a non-partial unique index
-- on the same triplet so the type-level types include it, but the
-- partial index here is what actually enforces "one tenant-default"
-- in Postgres (NULLs are otherwise treated as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_layouts_tenant_persona_default
  ON public.portal_layouts (tenant_id, persona_id)
  WHERE user_id IS NULL;

-- One layout per (tenant, persona, user) when user_id is non-NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_layouts_tenant_persona_user
  ON public.portal_layouts (tenant_id, persona_id, user_id)
  WHERE user_id IS NOT NULL;

-- ============================================================================
-- 5. RLS — enforce tenant isolation (mirrors migration 0155/0156/0163)
-- ============================================================================

ALTER TABLE public.portal_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_layouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON public.portal_layouts;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.portal_layouts;

CREATE POLICY tenant_isolation_select ON public.portal_layouts
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON public.portal_layouts
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON public.portal_layouts FROM anon;

-- ============================================================================
-- 6. Operator notes
-- ============================================================================

COMMENT ON TABLE public.portal_layouts IS
  '0164 — per-(tenant, persona, user) PortalLayout JSON documents backing the dynamic per-user UI primitive. See .audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md.';

COMMENT ON COLUMN public.portal_layouts.layout IS
  'Full PortalLayout document validated by @borjie/genui/document.ts PortalLayoutSchema.';

COMMENT ON COLUMN public.portal_layouts.user_id IS
  'NULL = tenant-default for the persona; non-NULL = user-specific override.';

COMMENT ON CONSTRAINT portal_layouts_persona_chk ON public.portal_layouts IS
  '0164 — persona_id must match a TRC seed role (internal_admin / property_manager / estate_manager / owner / customer).';
