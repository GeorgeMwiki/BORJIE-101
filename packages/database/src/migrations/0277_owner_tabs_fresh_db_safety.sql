-- =============================================================================
-- Migration 0277 — owner_tabs fresh-DB safety re-assertion for the
-- server-side cross-device tab-persistence tool surface.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner cockpit tab strip is persisted server-side in `owner_tabs`
-- (one row per (tenant_id, user_id); the FE owns the `state` jsonb shape).
-- That table was created in migration 0089 and had its RLS policy repointed
-- from the legacy `app.tenant_id` GUC to the canonical `app.current_tenant_id`
-- GUC in migration 0156.
--
-- Wave OWNER-OS-DURABLE promotes the chat-driven tab tools from CLIENT
-- round-trips (`mining.ui.pin_tab` / `reorder_tab` / `remove_tab`, which only
-- emit a chip the FE persists) to SERVER-PERSISTED per-tab operations:
--   * mining.ui.tabs.spawn   — spawn / augment a single tab (merge-context)
--   * mining.ui.tabs.update  — patch one tab (title / context / +N badge)
--   * mining.ui.tabs.close   — close (remove) one tab
-- backed by new handlers on the existing `/api/v1/owner/tabs` route
-- (POST / · PATCH /:id · DELETE /:id · POST /sync · POST /:id/close ·
-- POST /:id/update). Every one of those handlers reads + writes
-- `owner_tabs.state`, so the durable surface is now load-bearing for the
-- brain-tool path, not just the FE store.
--
-- This migration is a DEFENSIVE, IDEMPOTENT re-assertion that the `owner_tabs`
-- table, its FORCE-RLS tenant-isolation policy on the CANONICAL
-- `app.current_tenant_id` GUC, and the per-user hydrate index all exist. On a
-- fully-migrated database it is a pure no-op (every statement is IF NOT EXISTS
-- / DROP-then-CREATE-POLICY guarded). On a FRESH or partially-applied database
-- it guarantees the tool-backed handlers always have a correctly-secured table
-- to persist to — the fresh-DB-safety guarantee.
--
-- IT REFERENCES ONLY PRE-EXISTING CONSTRUCTS: the `owner_tabs` columns are
-- exactly the 0089 shape (no new column, no new table, no FK to anything that
-- might not exist). NOTHING money-shaped lives here — pure UI-structure state.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (the canonical GUC the
--     api-gateway databaseMiddleware binds; NEVER the legacy app.tenant_id).
--   * REVOKE anon, guarded for vanilla Postgres / CI empty-PG (anon is a
--     Supabase-only role).
--   * Migrations are immutable + forward-only: this APPENDS a new numbered
--     file; it edits no shipped migration. Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — owner_tabs (re-assert the 0089 shape, idempotently).
--
-- One row per (tenant_id, user_id). `state` is an opaque jsonb document — the
-- FE store + the server tab handlers share its shape ({ tabs: [...],
-- activeTabId }). The composite PRIMARY KEY (tenant_id, user_id) is the
-- per-user lookup the GET / PUT / POST / PATCH / DELETE / sync handlers all
-- key on. CREATE TABLE IF NOT EXISTS is a no-op on an existing DB.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_tabs (
  tenant_id   text        NOT NULL,
  /** Supabase user id of the owner whose tab layout this row describes. */
  user_id     text        NOT NULL,
  /** Free-form jsonb shape — the FE owns the schema. Persisted verbatim so the
   *  FE store can hydrate in one round-trip and the server tab tools can
   *  spawn / augment / update / close a single tab inside it. NEVER money. */
  state       jsonb       NOT NULL DEFAULT '{"tabs":[],"activeTabId":null}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy on the CANONICAL GUC.
--
-- Mirrors 0156's repoint: current_setting('app.current_tenant_id', true).
-- tenant_id is TEXT so the compare is bare (no cast). FOR ALL covers the
-- hydrate SELECT, the POST / PATCH / DELETE / sync UPSERTs, and the tool-path
-- writes. Idempotent: ENABLE / FORCE are no-ops if already set; the policy is
-- DROP-then-CREATE so a re-run lands the canonical-GUC definition regardless of
-- whatever a partial 0089-only DB left behind.
-- -----------------------------------------------------------------------------

ALTER TABLE owner_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_tabs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_tabs_tenant_isolation ON owner_tabs;
CREATE POLICY owner_tabs_tenant_isolation
  ON owner_tabs
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- anon is a Supabase construct; guard so the migration still applies on a
-- vanilla Postgres (CI empty-PG check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.owner_tabs FROM anon;';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — per-user freshness index.
--
-- The cross-device sync contract has every client replay GET / on focus to
-- pick up another device's mutation; that lookup is by (tenant_id, user_id)
-- and is already served by the PRIMARY KEY. We additionally index updated_at
-- within the per-user key so a future "which of my devices wrote last" /
-- "tabs touched since T" query stays index-only. IF NOT EXISTS keeps it a
-- no-op on re-run.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS owner_tabs_tenant_user_updated_idx
  ON owner_tabs(tenant_id, user_id, updated_at DESC);

COMMENT ON TABLE owner_tabs IS
  'Per-user owner cockpit tab strip state: one row per (tenant_id, user_id), '
  'state is an opaque jsonb document the FE store + the server tab tools '
  '(mining.ui.tabs.spawn/update/close, /api/v1/owner/tabs) share. Cross-device '
  'durable. NO money columns. RLS FORCE on the canonical app.current_tenant_id '
  'GUC (0156). Created 0089; fresh-DB safety re-asserted 0277.';

COMMIT;
