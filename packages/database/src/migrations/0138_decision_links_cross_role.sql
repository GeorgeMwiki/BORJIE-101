-- =============================================================================
-- Migration 0138 - Decision-journal cross-role links (Wave KNOWLEDGE-HANDOFF)
--
-- Companion to:
--   - services/api-gateway/src/services/decision-journal/recorder.ts (extended)
--   - services/api-gateway/src/services/decision-journal/cross-role-linker.ts (new)
--   - packages/central-intelligence/src/handoff/
--   - Docs/RESEARCH/KNOWLEDGE_HANDOFF_SOTA_2026-05-29.md (K-C section)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- When the owner makes a decision affecting a manager's worktree
-- (any open `mining_tasks` under the scope the decision touches), the
-- decision recorder auto-inserts one or more `decision_links` rows
-- pointing at that manager's role + user_id. The manager's mobile
-- shows "Decisions affecting your work" as a curated feed without
-- polling.
--
-- The columns are NULLABLE so existing decision_links rows (those
-- pointing decision -> decision via supersedes / depends_on / etc.)
-- remain valid. A row is interpreted as cross-role iff
-- `target_role IS NOT NULL`. The CHECK constraint enforces that when
-- target_role is set, target_user_id is set too.
--
-- The `relationship` column gets one new value: `affects_role`.
--
-- Tenant scope: rows already filtered by the existing
-- `decision_links_tenant_isolation` policy (migration 0116). Cross-
-- role visibility is gated by the manager's RLS scope on the
-- `mining_tasks` join — the link is only meaningful when the target
-- user has at least one open task under one of the decision's scope
-- ids.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- ─── Extend decision_links with cross-role columns ────────────────────────
ALTER TABLE decision_links
  ADD COLUMN IF NOT EXISTS target_role     text,
  ADD COLUMN IF NOT EXISTS target_user_id  text;

DO $$
BEGIN
  -- Drop the existing relationship CHECK so we can re-add it with the
  -- new `affects_role` value. The constraint name comes from migration
  -- 0116 (decision_links_relationship_chk).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_links_relationship_chk'
  ) THEN
    ALTER TABLE decision_links DROP CONSTRAINT decision_links_relationship_chk;
  END IF;

  ALTER TABLE decision_links
    ADD CONSTRAINT decision_links_relationship_chk
    CHECK (relationship IN (
      'supersedes', 'depends_on', 'informed_by', 'reversed_by', 'affects_role'
    ));

  -- When target_role is set, target_user_id MUST be set (and vice versa).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_links_target_pair_chk'
  ) THEN
    ALTER TABLE decision_links
      ADD CONSTRAINT decision_links_target_pair_chk
      CHECK (
        (target_role IS NULL AND target_user_id IS NULL)
        OR (target_role IS NOT NULL AND target_user_id IS NOT NULL)
      );
  END IF;

  -- The role must match the persona slug catalogue.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_links_target_role_chk'
  ) THEN
    ALTER TABLE decision_links
      ADD CONSTRAINT decision_links_target_role_chk
      CHECK (
        target_role IS NULL OR target_role IN (
          'T1_owner_strategist',
          'T2_admin_strategist',
          'T3_module_manager',
          'T4_field_employee',
          'T5_customer_concierge',
          'T_auditor',
          'T_vendor'
        )
      );
  END IF;
END $$;

-- Hot path: "Decisions affecting your work" feed for the manager.
-- The query is: target_user_id = $1 AND tenant_id = current_tenant.
CREATE INDEX IF NOT EXISTS decision_links_target_user_idx
  ON decision_links (tenant_id, target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;

-- Hot path: "Who is affected by this decision?" — read by the
-- decision-journal UI when surfacing a decision to the owner.
CREATE INDEX IF NOT EXISTS decision_links_source_role_idx
  ON decision_links (tenant_id, source_decision_id)
  WHERE target_role IS NOT NULL;

COMMIT;
