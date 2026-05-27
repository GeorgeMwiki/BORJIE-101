-- =============================================================================
-- Migration 0080 — Mining Worker Tasks + Pre-Shift Toolbox Talks
--
-- Companion to:
--   - services/api-gateway/src/routes/mining/tasks.hono.ts
--   - services/api-gateway/src/routes/mining/toolbox.hono.ts
--   - packages/database/src/schemas/mining-tasks.schema.ts
--   - Docs/research/worker-guidance-sota.md §9 ("New endpoints required")
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Two tables:
--
--   mining_tasks          — manager-assigned work units for site workers.
--                           Drives the workforce home screen "Task queue
--                           (3 visible)" stack and the swipe-right →
--                           complete / swipe-left → block flows. Lifecycle
--                           state machine: pending → in_progress → done |
--                           blocked | cancelled. Bilingual (sw + en) per
--                           CLAUDE.md "Swahili-first" hard rule. Tasks
--                           are tenant-scoped; site_id is OPTIONAL so a
--                           manager can assign cross-site tasks (e.g.
--                           pick up parts at HQ → bring to pit).
--
--   mining_toolbox_talks  — pre-shift safety briefings. One row per
--                           (site, day). Workers sign off via fingerprint
--                           or in-app acknowledgement; acknowledged_by_
--                           user_ids accumulates the worker user ids that
--                           have completed the briefing. Bilingual topic +
--                           notes.
--
-- Both tables FORCE RLS. The canonical isolation predicate is
-- `tenant_id::text = current_setting('app.current_tenant_id', true)` — set
-- by the api-gateway database middleware on every authenticated request
-- (see services/api-gateway/src/middleware/database.ts).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this
-- file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- mining_tasks — manager-assigned work units for site workers
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_tasks (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  /** Optional — cross-site tasks (e.g. parts pickup) leave this NULL. */
  site_id                     uuid,
  /** Worker the task is delegated to. NULL = unassigned (manager queue). */
  assigned_to_user_id         uuid,
  /** Manager who created the task. NULL only for system-generated tasks. */
  assigned_by_user_id         uuid,
  /** Bilingual title — Swahili required, English optional per CLAUDE.md. */
  title_sw                    text        NOT NULL,
  title_en                    text,
  description_sw              text,
  description_en              text,
  /** low | normal | high | urgent. */
  priority                    text        NOT NULL DEFAULT 'normal',
  /** pending | in_progress | done | blocked | cancelled. */
  status                      text        NOT NULL DEFAULT 'pending',
  /** Self-FK — task chains (this task must complete before that one). */
  sequenced_after_task_id     uuid        REFERENCES mining_tasks(id) ON DELETE SET NULL,
  due_at                      timestamptz,
  completed_at                timestamptz,
  blocked_reason              text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  /** Pointer into ai_audit_chain for forensic replay (CLAUDE.md hash-chain rule). */
  hash_chain_id               uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_priority_chk'
  ) THEN
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_priority_chk
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_status_chk'
  ) THEN
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_status_chk
      CHECK (status IN ('pending', 'in_progress', 'done', 'blocked', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_title_sw_nonempty_chk'
  ) THEN
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_title_sw_nonempty_chk
      CHECK (length(title_sw) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_blocked_reason_chk'
  ) THEN
    -- A blocked task MUST carry a reason; non-blocked tasks may or may not.
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_blocked_reason_chk
      CHECK (status <> 'blocked' OR length(coalesce(blocked_reason, '')) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_completed_at_chk'
  ) THEN
    -- A done task MUST have completed_at; never-done tasks MUST NOT.
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_completed_at_chk
      CHECK (
        (status = 'done' AND completed_at IS NOT NULL)
        OR (status <> 'done' AND completed_at IS NULL)
      );
  END IF;
END $$;

-- Hot path: list a worker's open tasks.
CREATE INDEX IF NOT EXISTS idx_mining_tasks_tenant_assignee_status
  ON mining_tasks (tenant_id, assigned_to_user_id, status);

-- Manager dashboards: rollups by site.
CREATE INDEX IF NOT EXISTS idx_mining_tasks_tenant_site_status
  ON mining_tasks (tenant_id, site_id, status);

-- Created-at ordering for "newest first" listings.
CREATE INDEX IF NOT EXISTS idx_mining_tasks_tenant_created
  ON mining_tasks (tenant_id, created_at DESC);

ALTER TABLE mining_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_tasks FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_tasks'
       AND policyname = 'mining_tasks_tenant_isolation'
  ) THEN
    CREATE POLICY mining_tasks_tenant_isolation
      ON mining_tasks
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- mining_toolbox_talks — pre-shift safety briefings (one per site per day)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_toolbox_talks (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid        NOT NULL,
  site_id                       uuid        NOT NULL,
  topic_sw                      text        NOT NULL,
  topic_en                      text,
  scheduled_for                 date        NOT NULL,
  led_by_user_id                uuid,
  /** Array of worker user_ids that have signed off (acknowledged) the briefing. */
  acknowledged_by_user_ids      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  briefing_notes_sw             text,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_toolbox_talks_topic_sw_nonempty_chk'
  ) THEN
    ALTER TABLE mining_toolbox_talks
      ADD CONSTRAINT mining_toolbox_talks_topic_sw_nonempty_chk
      CHECK (length(topic_sw) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_toolbox_talks_ack_is_array_chk'
  ) THEN
    ALTER TABLE mining_toolbox_talks
      ADD CONSTRAINT mining_toolbox_talks_ack_is_array_chk
      CHECK (jsonb_typeof(acknowledged_by_user_ids) = 'array');
  END IF;
END $$;

-- Hot path: list today's talks for a site.
CREATE INDEX IF NOT EXISTS idx_mining_toolbox_talks_tenant_site_date
  ON mining_toolbox_talks (tenant_id, site_id, scheduled_for);

-- Per-tenant date ordering for the daily-briefings dashboard.
CREATE INDEX IF NOT EXISTS idx_mining_toolbox_talks_tenant_date
  ON mining_toolbox_talks (tenant_id, scheduled_for DESC);

ALTER TABLE mining_toolbox_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_toolbox_talks FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_toolbox_talks'
       AND policyname = 'mining_toolbox_talks_tenant_isolation'
  ) THEN
    CREATE POLICY mining_toolbox_talks_tenant_isolation
      ON mining_toolbox_talks
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
