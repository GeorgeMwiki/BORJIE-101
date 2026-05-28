-- =============================================================================
-- Migration 0097 — Brain-in-control of the UI (BRAIN-UI-CONTROL wave)
--
-- Lets the brain RESHAPE what the owner sees:
--
--   1. owner_dashboard_layout  — per-user persisted dashboard tile order +
--      sidebar order. The DashboardComposer + Sidebar read these on
--      mount; the brain mutates them through the `<dashboard_compose>`
--      and `<nav_rearrange>` Accept flows.
--
--   2. ui_redesign_audit       — hash-chained append-only audit of every
--      brain redesign proposal + owner Accept / Reject. Mirrors the
--      pattern in ai_audit_chain (CLAUDE.md hard rule: hash-chained,
--      append-only, no mutation).
--
-- Both tables are tenant-scoped with RLS FORCE-enabled. Migration is
-- idempotent (IF NOT EXISTS / DO blocks) and forward-only — never edit.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) owner_dashboard_layout — per-user persisted layout overrides.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_dashboard_layout (
  tenant_id      text        NOT NULL,
  /** Supabase user id of the owner whose layout this row describes. */
  user_id        text        NOT NULL,
  /** Ordered list of dashboard tile ids the composer should render
   *  (top-first). NULL entries are skipped. */
  tile_order     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Tile ids the composer should hide entirely. */
  hidden_tiles   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Ordered list of sidebar nav item hrefs (top-first). */
  sidebar_order  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Free-form metadata (e.g. brain-supplied `reason` + audit pointer). */
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  /** Supabase user id that authored the last update — owner OR brain
   *  (brain rows carry the literal string 'brain'). */
  updated_by     text        NOT NULL DEFAULT 'owner',
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE owner_dashboard_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_dashboard_layout FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_dashboard_layout'
       AND policyname = 'owner_dashboard_layout_tenant_isolation'
  ) THEN
    CREATE POLICY owner_dashboard_layout_tenant_isolation
      ON owner_dashboard_layout
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) ui_redesign_audit — hash-chained append-only proposal + decision log.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ui_redesign_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  /** Supabase user id of the owner. */
  user_id         text        NOT NULL,
  /** What the brain proposed: tab_redesign | dashboard_compose | nav_rearrange. */
  kind            text        NOT NULL,
  /** Lifecycle stage: proposed | accepted | rejected | expired. */
  stage           text        NOT NULL,
  /** The full payload as emitted by the brain (validated by parser before
   *  insertion). */
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Brain's plain-text rationale (`reason` field). Surfaced to the owner. */
  reason          text,
  /** Optional ttl in seconds — only meaningful for tab_redesign rows. */
  ttl_seconds     integer,
  /** Optional client session id for correlation. */
  session_id      text,
  /** Optional reference to a chat message that triggered this row. */
  message_id      text,
  /** SHA-256 hex of the previous row's hash + this row's canonical
   *  payload. The chain head (first row in a tenant) carries the literal
   *  'GENESIS' here so the verifier knows where to stop. */
  prev_hash       text        NOT NULL,
  /** SHA-256 hex of this row's canonical content. Computed app-side. */
  row_hash        text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ui_redesign_audit_kind_chk'
  ) THEN
    ALTER TABLE ui_redesign_audit
      ADD CONSTRAINT ui_redesign_audit_kind_chk
      CHECK (kind IN ('tab_redesign', 'dashboard_compose', 'nav_rearrange'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ui_redesign_audit_stage_chk'
  ) THEN
    ALTER TABLE ui_redesign_audit
      ADD CONSTRAINT ui_redesign_audit_stage_chk
      CHECK (stage IN ('proposed', 'accepted', 'rejected', 'expired'));
  END IF;
END $$;

-- Per-tenant chain head lookup — newest-first.
CREATE INDEX IF NOT EXISTS idx_ui_redesign_audit_chain_head
  ON ui_redesign_audit (tenant_id, created_at DESC);

-- Per-user inbox lookup for renderable history.
CREATE INDEX IF NOT EXISTS idx_ui_redesign_audit_user
  ON ui_redesign_audit (tenant_id, user_id, created_at DESC);

ALTER TABLE ui_redesign_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ui_redesign_audit FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'ui_redesign_audit'
       AND policyname = 'ui_redesign_audit_tenant_isolation'
  ) THEN
    CREATE POLICY ui_redesign_audit_tenant_isolation
      ON ui_redesign_audit
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
