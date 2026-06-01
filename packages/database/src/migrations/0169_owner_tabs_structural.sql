-- =============================================================================
-- Migration 0169 — owner_tabs_structural: server-PERSISTED, per-tab structural
-- store for the owner cockpit tab strip (one ROW per tab, not one opaque blob).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The cockpit tab strip already had a server row (`owner_tabs`, migration 0089)
-- BUT that row stores the whole strip as a SINGLE opaque jsonb document where
-- "the FE owns the schema". Structural tab operations the brain emits from chat
-- (`mining.ui.pin_tab` / `reorder_tab` / `remove_tab` — see
-- services/api-gateway/src/composition/brain-tools/chat-everywhere-tools.ts)
-- were therefore FE-CHIP-ONLY: the handler emitted a chip and the FE store
-- persisted it via PUT /owner/tabs. Nothing on the server could spawn, pin,
-- reorder, or remove a tab durably, so "Mr. Mwikila can do anything from chat"
-- did not actually hold for tab structure — a chip dropped on the floor (no FE
-- listening, a different device, a script) left the strip unchanged.
--
-- This table promotes tab structure to a DURABLE, QUERYABLE, tenant-scoped row
-- set: one row per (tenant_id, user_id, tab_id). The action-executor `manage_tab`
-- verb (spawn | update | remove | reorder | pin) writes here directly, so a tab
-- op persists server-side regardless of any FE listener, and the existing
-- FE-chip tab tools become a thin echo of a real server write.
--
-- NO MONEY COLUMNS. This is pure UI-structure state (label / position / pinned /
-- kind / config). There is nothing money-shaped here for any code path to write
-- by mistake. Soft-delete (`status='removed'`) preserves the row for audit /
-- undo rather than hard-deleting it.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0164's CORRECT
--     GUC; never the legacy app.tenant_id). REVOKE anon (guarded for vanilla PG
--     / CI empty-PG).
--   * user_id is carried for per-user scoping (each owner owns their own strip)
--     but RLS isolates by TENANT; the app additionally predicates on user_id in
--     every query (belt-and-braces, matching the action-executor handlers).
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — owner_tabs_structural
--
-- One row per tab in an owner's cockpit strip. `tab_id` is the stable client-
-- supplied id the FE store and the chat chips both key on (e.g. 'chat',
-- 'compliance', or a generated id for a spawned custom tab). `position` is the
-- zero-based slot in the strip; `pinned` tabs sort ahead of un-pinned ones in
-- the FE. `kind` is a small free-text class ('system' | 'custom' | …) so system
-- tabs can be protected from removal. `config` is a flexible jsonb bag for any
-- per-tab options (query, filters, title overrides) — never money. `status`
-- soft-deletes a tab ('active' | 'removed') so the row survives for undo/audit.
-- status is TEXT with a CHECK (the small closed set) — no pg_enum so the
-- migration stays forward-only + re-runnable.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_tabs_structural (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  /** Stable client/chat tab id (the FE store + chat chips both key on this). */
  tab_id      TEXT NOT NULL,
  label       TEXT NOT NULL,
  /** Zero-based slot in the strip. */
  position    INTEGER NOT NULL DEFAULT 0,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  /** 'system' tabs cannot be removed; 'custom' tabs can. Free text + CHECK. */
  kind        TEXT NOT NULL DEFAULT 'custom'
                CHECK (kind IN ('system','custom')),
  /** Flexible per-tab options bag (query/filters/title). NEVER money. */
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','removed')),
  /** Chat-as-OS provenance ({via, actorId, requestedAt, ...}). */
  provenance  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (tenant, user, tab_id): a tab id is unique within an owner's strip
-- so spawn is idempotent and update/remove/reorder/pin target exactly one row.
CREATE UNIQUE INDEX IF NOT EXISTS owner_tabs_structural_tenant_user_tab_idx
  ON owner_tabs_structural(tenant_id, user_id, tab_id);

-- Hydrate hot path: an owner's ACTIVE tabs in strip order.
CREATE INDEX IF NOT EXISTS owner_tabs_structural_tenant_user_status_idx
  ON owner_tabs_structural(tenant_id, user_id, status, position);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0164 §2: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the manage_tab INSERT + the
-- hydrate SELECT + the update/remove/reorder/pin UPDATE. Idempotent: ENABLE/FORCE
-- are no-ops if already set; policy guarded by a pg_policies existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'owner_tabs_structural'
  ) THEN
    EXECUTE 'ALTER TABLE public.owner_tabs_structural ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.owner_tabs_structural FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'owner_tabs_structural'
        AND policyname = 'owner_tabs_structural_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY owner_tabs_structural_tenant_isolation ON public.owner_tabs_structural
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.owner_tabs_structural FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE owner_tabs_structural IS
  'Server-persisted, per-tab structural store for the owner cockpit tab strip: '
  'one row per (tenant_id, user_id, tab_id). Backs the action-executor manage_tab '
  'verb (spawn/update/remove/reorder/pin) so tab structure persists server-side '
  'instead of FE-chip-only. Soft-delete via status=removed preserves rows for '
  'undo/audit. NO money columns — pure UI structure. RLS FORCE on '
  'app.current_tenant_id. Added in 0169.';

COMMIT;
