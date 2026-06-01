-- =============================================================================
-- Migration 0170 — portal_tabs: the MD-authored "infinite dynamic tabs" store.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Borjie's brain (Mr. Mwikila) lets the Managing Director AUTHOR brand-new
-- domain tabs by talking to it ("we need to track our staff payroll"). The
-- `@borjie/portal-genui` engine detects the tab-generation intent, asks the
-- multi-LLM synthesizer to draft a complete `PortalTab` document (sections of
-- typed fields + widgets + persona permissions), zod-validates it, then
-- PERSISTS it here so the tab survives sign-out and re-appears on the next
-- login — on every device the owner is signed in on.
--
-- This table is the durable substrate the engine's Drizzle adapter
-- (`packages/portal-genui/src/persistence/drizzle-tab-repo.ts`) targets. The
-- adapter speaks plain parameterised SQL against these exact columns
-- (id, tenant_id, user_id, tab_key, schema_version, tab, parent_tab_id,
-- created_at, updated_at) so it can typecheck without dragging the heavier
-- `@borjie/database` dependency tree into the Node-only engine package.
--
-- It is the dynamic SIBLING of portal_layouts (migration 0164): portal_layouts
-- stores the per-user FRAME (topbar / sidebar / dashboard cells); portal_tabs
-- stores the dynamic tabs that hang off that frame. NO money columns — a tab is
-- a UI/forms document only. Any money a generated form ultimately captures
-- still flows through the gated action-executor verbs and LedgerService
-- (CLAUDE.md hard rule); nothing money-shaped is writable here.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0164's CORRECT
--     GUC; never the legacy app.tenant_id). REVOKE anon (guarded for vanilla
--     PG / CI empty-PG via a pg_roles existence check).
--   * tab is a JSONB blob holding the whole validated PortalTab document; the
--     typed header columns sit OUTSIDE the JSONB so RLS, the unique index, and
--     the lineage lookup work without GIN extractors.
--   * UNIQUE(tenant_id, tab_key): one tab_key per tenant. The MD authors a tab
--     once for the org; re-authoring the same key updates the existing row
--     (the adapter's ON CONFLICT (id) handles the row-id collision; this
--     constraint guarantees no two distinct rows ever claim the same tenant
--     tab_key). user_id is carried for per-user provenance / scoping but
--     isolation is by TENANT; the app additionally predicates on tenant_id in
--     every query (belt-and-braces, matching the repo handlers).
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable" (0168 is reserved for a sibling; 0169 is
-- owner_tabs_structural; this is the next free number).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — portal_tabs
--
-- `tab` is the full PortalTab JSONB (title, description, icon, domain, sections
-- of fields + widgets, persona permissions, append-only audit ring). The engine
-- zod-validates the document BEFORE it ever reaches this INSERT, so a buggy LLM
-- output cannot ship — the column is intentionally an opaque jsonb blob here.
-- `schema_version` mirrors PORTAL_TAB_SCHEMA_VERSION (currently 1) for forward
-- migrations. `parent_tab_id` models fork lineage so the UI can show
-- "previous version" diffs (NULL = root).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portal_tabs (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT,
  tab_key         TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  tab             JSONB NOT NULL,
  parent_tab_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listing hot path: "this tenant's tabs (optionally for this user)" — the
-- GET /api/v1/portal-genui/tabs query filters (tenant_id, user_id) and orders
-- by tab_key. A composite index covers both the tenant-default (user_id NULL)
-- and per-user reads.
CREATE INDEX IF NOT EXISTS portal_tabs_tenant_user_idx
  ON portal_tabs(tenant_id, user_id);

-- Lineage lookup for "previous version" diffs.
CREATE INDEX IF NOT EXISTS portal_tabs_parent_idx
  ON portal_tabs(parent_tab_id);

-- One tab_key per tenant (task-mandated). A second distinct row claiming the
-- same (tenant_id, tab_key) is rejected, surfacing as the engine's
-- `tab_key_already_exists` 409 at the API layer.
CREATE UNIQUE INDEX IF NOT EXISTS portal_tabs_tenant_tab_key_uq
  ON portal_tabs(tenant_id, tab_key);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0164 §2: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the adapter's INSERT/UPSERT, the
-- list/get SELECT, and the DELETE. Idempotent: ENABLE/FORCE are no-ops if
-- already set; the policy is guarded by a pg_policies existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'portal_tabs'
  ) THEN
    EXECUTE 'ALTER TABLE public.portal_tabs ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.portal_tabs FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'portal_tabs'
        AND policyname = 'portal_tabs_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY portal_tabs_tenant_isolation ON public.portal_tabs
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.portal_tabs FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE portal_tabs IS
  'MD-authored dynamic portal tabs (the "infinite dynamic tabs" store). One row '
  'per generated PortalTab document; `tab` is the zod-validated JSONB. The brain '
  'mints tabs from chat intent via @borjie/portal-genui; they persist here and '
  're-appear on next login across devices. Sibling of portal_layouts (the frame). '
  'NO money columns — UI/forms document only; money flows through gated verbs + '
  'LedgerService. RLS FORCE on app.current_tenant_id; UNIQUE(tenant_id, tab_key). '
  'Added in 0170.';

COMMIT;
