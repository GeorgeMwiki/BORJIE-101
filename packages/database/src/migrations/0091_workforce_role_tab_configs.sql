-- =============================================================================
-- Migration 0091 — Workforce Role Tab Configs + Change Requests
--
-- Wave: WORKFORCE-FIXED-TABS.
--
-- Companion to:
--   - packages/database/src/schemas/workforce-role-tab-configs.schema.ts
--   - services/api-gateway/src/routes/workforce/tab-configs.hono.ts
--   - apps/owner-web/src/app/(routes)/workforce-tabs/page.tsx
--   - apps/admin-web/src/app/workforce-tab-policies/page.tsx
--   - apps/workforce-mobile/src/lib/hooks/useWorkforceTabConfig.ts
--   - packages/persona-runtime/src/workforce-tab-catalog.ts
--
-- The workforce app uses FIXED tabs only — never dynamic spawning. Tab
-- visibility for a worker is a function of:
--   (a) the worker's ROLE
--   (b) the worker's SCOPE (assigned site / "global")
--   (c) what the OWNER PORTAL has enabled for that role+scope
--
-- Any worker request to change tabs / layout MUST route through
-- `workforce_tab_change_requests` for owner approval. Both tables hash-
-- chain into `ai_audit_chain` on every create / decide / apply so the
-- chain remains tamper-evident.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) workforce_role_tab_configs — the owner-set per-(role,scope) catalog
--    of enabled fixed tab ids + density. One row per (tenant, role,
--    site_scope). site_scope is the literal string 'global' or a site_id
--    uuid (rendered as text so the unique key composes cleanly).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_role_tab_configs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** RLS-scoping column. tenant id is `text` repo-wide so we mirror it. */
  tenant_id           text        NOT NULL,
  /** owner | manager | supervisor | pit_operator | geologist | treasury |
   *  safety_officer | compliance_clerk. Enforced by API zod schema. */
  role                text        NOT NULL,
  /** 'global' or a site_id uuid rendered as text. */
  site_scope          text        NOT NULL,
  /** Ordered subset of WORKFORCE_TAB_CATALOG ids. The 'chat' tab MUST
   *  always be present (api-gateway enforces this on PUT). */
  enabled_tab_ids     text[]      NOT NULL,
  /** comfortable | compact. Drives mobile tab strip density. */
  layout_density      text        NOT NULL DEFAULT 'comfortable',
  /** Supabase user id of the owner / admin who last updated this row. */
  updated_by_user_id  text        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  /** Hash-chained audit-trail link. Set on every owner PUT. */
  hash_chain_id       uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_role_tab_configs_density_chk'
  ) THEN
    ALTER TABLE workforce_role_tab_configs
      ADD CONSTRAINT workforce_role_tab_configs_density_chk
      CHECK (layout_density IN ('comfortable', 'compact'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'uq_workforce_role_tab_configs_tenant_role_scope'
  ) THEN
    CREATE UNIQUE INDEX uq_workforce_role_tab_configs_tenant_role_scope
      ON workforce_role_tab_configs (tenant_id, role, site_scope);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workforce_role_tab_configs_tenant_role
  ON workforce_role_tab_configs (tenant_id, role);

ALTER TABLE workforce_role_tab_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_role_tab_configs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_role_tab_configs'
       AND policyname = 'workforce_role_tab_configs_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_role_tab_configs_tenant_isolation
      ON workforce_role_tab_configs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) workforce_tab_change_requests — workers cannot change their own
--    tabs. They submit a request here; the owner approves / rejects.
--    Approval auto-applies the diff to the matching role-tab-configs row.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_tab_change_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  /** Supabase user id of the worker who submitted the request. */
  requester_user_id   text        NOT NULL,
  /** Worker's role at request time (denormalised so audit reads cleanly). */
  requester_role      text        NOT NULL,
  /** Optional site scope the request applies to. NULL = global. */
  site_id             uuid,
  /** Worker-supplied justification. */
  reason              text        NOT NULL,
  /** {addTabs?: text[], removeTabs?: text[], densityChange?: text}. */
  requested_changes   jsonb       NOT NULL,
  /** pending | approved | rejected | applied | cancelled. */
  status              text        NOT NULL DEFAULT 'pending',
  /** Supabase user id of the owner / admin who decided the request. */
  decided_by_user_id  text,
  decided_at          timestamptz,
  decision_note       text,
  /** Hash-chained audit-trail link. Set on every create / decide / apply. */
  audit_hash_id       uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_tab_change_requests_status_chk'
  ) THEN
    ALTER TABLE workforce_tab_change_requests
      ADD CONSTRAINT workforce_tab_change_requests_status_chk
      CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workforce_tab_change_requests_tenant_status_created
  ON workforce_tab_change_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workforce_tab_change_requests_requester
  ON workforce_tab_change_requests (tenant_id, requester_user_id, created_at DESC);

ALTER TABLE workforce_tab_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_tab_change_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_tab_change_requests'
       AND policyname = 'workforce_tab_change_requests_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_tab_change_requests_tenant_isolation
      ON workforce_tab_change_requests
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
