-- =============================================================================
-- Migration 0328 — portal_tab_records: the generic record store that makes a
-- GENERATED tab ACT (Keystone K1a).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The brain mints dynamic tabs (`@borjie/portal-genui`, migration 0170 stores
-- the tab DOCUMENT in portal_tabs). But a generated tab was render-only: its
-- schema expressed WHAT a field/widget is, never WHAT IT DOES, and there was no
-- place for the records the tab collects to live. A user could see an HR-payroll
-- tab but never SUBMIT a payroll row.
--
-- This table is the generic, schema-on-read record store. There is NO per-tab
-- table: every record from every generated tab lands here as a JSONB `payload`,
-- tenant-scoped and keyed by `tab_id` / `tab_key`. The payload SHAPE is enforced
-- at write time by the OWNING tab's own PortalTabField[] (see
-- packages/portal-genui/src/persistence/record-validator.ts — required present,
-- kind-appropriate types, dropdown options membership, number min/max), so a
-- brand-new domain needs ZERO new migrations (composition, not new code).
--
-- ONE TABLE
--   * portal_tab_records — one row per submitted record. `payload` is the
--     validated submission. The money path is UNTOUCHED: this store never posts
--     accounting truth (LedgerService.post() owns the immutable double-entry
--     ledger); a tab record is application data, never a ledger entry.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (`tenant_id` TEXT; no FK —
-- same shape as portal_tabs / offtake_agreements / blackboard_slots). FORCE-
-- enables RLS with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC (bare compare, no cast; NEVER the legacy
-- `app.tenant_id`) plus a service-role bypass mirroring 0325 exactly. A TENANT
-- can NEVER read ANOTHER tenant's tab records.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is in
-- the CREATE TABLE or on a freshly-created column WITH a DEFAULT (created_at,
-- updated_at) so there is no backfill hazard and the NOT-NULL safety validator
-- passes.
--
-- Companion files:
--   * packages/portal-genui/src/persistence/record-store.ts (saveRecord/list/get)
--   * packages/portal-genui/src/persistence/record-validator.ts (generic validator)
--   * services/api-gateway/src/routes/portal-genui/portal-genui.router.ts (records endpoints)
--   * packages/database/src/migrations/down/0328_down_portal_tab_records.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- portal_tab_records — generic schema-on-read record store for generated tabs.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portal_tab_records (
  id                 uuid          NOT NULL DEFAULT gen_random_uuid(),
  -- RLS isolation key (the owning tenant). No FK — text tenant id, repo shape.
  tenant_id          text          NOT NULL,
  -- The owning portal_tabs row.
  tab_id             uuid          NOT NULL,
  -- Denormalised stable tab key (routing / filter without a join).
  tab_key            text          NOT NULL,
  -- The validated submission. Shape enforced at write time by the tab's fields.
  payload            jsonb         NOT NULL,
  -- The submitting user (audit / created_by).
  created_by_user_id text          NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT portal_tab_records_pkey PRIMARY KEY (id)
);

-- Hot read path: list a tab's records within a tenant.
CREATE INDEX IF NOT EXISTS portal_tab_records_tenant_tab_idx
  ON portal_tab_records (tenant_id, tab_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0325 shape exactly.
-- -----------------------------------------------------------------------------

-- NOTE on policy naming: the policy is named `tenant_isolation_<table>`
-- (prefix-form) — the form the repo's audit-rls-coverage scanner recognises for
-- loop-installed RLS, so this table is counted as covered without an allowlist
-- entry. The `tenant_tables` array variable name is likewise the scanner's
-- recognised loop shape.
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'portal_tab_records'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
