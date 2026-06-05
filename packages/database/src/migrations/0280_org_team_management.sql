-- =============================================================================
-- Migration 0280 — Org / team-management write surface (staff lifecycle).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Ported from the BossNyumba org/team-management stack (which itself ported
-- LitFin's iter-27..31 org-management tables), retargeted real-estate →
-- mining. Borjie had NO chat-reachable workforce-lifecycle write surface for
-- a mining operator to hire a staff member, assign a KPI, schedule a task, or
-- escalate to a human. This migration is the data layer for that vertical
-- slice, backing the `staff.*` chat brain tools (org-admin-tools.ts) and the
-- `/api/v1/org-admin/*` route surface:
--
--   staff_members     — one row per staff member in the org. RE caretaker /
--                       leasing_assistant → mining site_supervisor /
--                       pit_foreman / safety_officer / geologist / accountant.
--   staff_kpis        — KPI targets assigned to a staff member (e.g. "tonnes
--                       hauled this quarter", "95% pit-wall inspections on
--                       time").
--   org_tasks         — tasks scheduled to (optionally) a staff member (e.g.
--                       "weekly pit-wall inspection scheduling").
--   org_escalations   — escalations raised for a human to act on
--                       (compliance_breach / safety_incident /
--                       payment_default / other).
--
-- TOOLS BACKED:
--   staff.create / staff.assign_kpi / staff.schedule_task /
--   staff.escalate_to_human / staff.bulk_ingest_csv.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule):
--   NOTHING here hard-codes a jurisdiction currency. KPI metric units are
--   domain-neutral (count / percent / days / hours / ratio / currency); when a
--   KPI is denominated in money the `metric_unit = 'currency'` row carries no
--   jurisdiction code in this layer (the surface formats with formatCurrency at
--   render time). NEVER hard-code TZS/KES/UGX/NGN.
--
-- FRESH-DB SAFETY / IDEMPOTENCY
-- -----------------------------
-- Every statement is guarded: CREATE TABLE IF NOT EXISTS, DO-blocks that check
-- pg_constraint / pg_policies before ADD CONSTRAINT / CREATE POLICY, CREATE
-- (UNIQUE) INDEX IF NOT EXISTS, and a pg_roles guard around the anon REVOKE. On
-- a fully-migrated DB this is a pure no-op; on a FRESH or partially-applied DB
-- it stands the tables up correctly secured. The staff_kpis / org_tasks /
-- org_escalations tables reference staff_members with ON DELETE SET NULL (or
-- CASCADE for the KPI child) so removing a staff member does not cascade-
-- destroy historical task / escalation rows (forensic-retention friendly).
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped tables -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (the canonical GUC the
--     api-gateway databaseMiddleware binds; migration 0172 unified the helper
--     on this name). tenant_id is TEXT so the compare is bare (no cast). NEVER
--     the legacy app.tenant_id.
--   * REVOKE anon, guarded for vanilla Postgres / CI empty-PG (anon is a
--     Supabase-only role).
--   * Migrations are immutable + forward-only: this APPENDS a new numbered file
--     (next after 0279); it edits no shipped migration. Safe to re-run.
--
-- Companion files:
--   - packages/database/src/migrations/down/0280_down_org_team_management.sql
--   - packages/database/src/schemas/org-team-management.schema.ts
--   - services/api-gateway/src/routes/org-admin.hono.ts
--   - services/api-gateway/src/composition/org-team-repository.ts
--   - services/api-gateway/src/composition/org-team-csv.ts
--   - services/api-gateway/src/composition/brain-tools/org-admin-tools.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- §1 — staff_members.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  full_name     text        NOT NULL,
  role          text        NOT NULL,
  hire_date     timestamptz NOT NULL DEFAULT now(),
  manager_id    uuid        REFERENCES staff_members(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'active',
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance    jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids jsonb     NOT NULL DEFAULT '[]'::jsonb,
  created_by    text,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_members_status_chk'
  ) THEN
    ALTER TABLE staff_members
      ADD CONSTRAINT staff_members_status_chk
      CHECK (status IN ('active', 'suspended', 'terminated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_members_full_name_chk'
  ) THEN
    ALTER TABLE staff_members
      ADD CONSTRAINT staff_members_full_name_chk
      CHECK (char_length(full_name) BETWEEN 1 AND 200);
  END IF;
END $$;

-- Case-insensitive duplicate-name guard PER TENANT, scoped to non-terminated
-- rows so re-hiring a name after termination stays possible.
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_tenant_name_active_uq
  ON staff_members (tenant_id, lower(full_name))
  WHERE status <> 'terminated';

CREATE INDEX IF NOT EXISTS staff_members_tenant_status
  ON staff_members (tenant_id, status, created_at DESC);

-- -----------------------------------------------------------------------------
-- §2 — staff_kpis.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_kpis (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  staff_member_id     uuid        NOT NULL
                        REFERENCES staff_members(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  description         text,
  metric_unit         text        NOT NULL DEFAULT 'count',
  target_value        numeric(18, 4) NOT NULL,
  current_value       numeric(18, 4) NOT NULL DEFAULT 0,
  period              text        NOT NULL DEFAULT 'quarter',
  period_end          timestamptz,
  status              text        NOT NULL DEFAULT 'active',
  assigned_by_user_id text,
  origin_session_id   text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_kpis_metric_unit_chk'
  ) THEN
    ALTER TABLE staff_kpis
      ADD CONSTRAINT staff_kpis_metric_unit_chk
      CHECK (metric_unit IN
        ('count', 'currency', 'percent', 'days', 'hours', 'ratio'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_kpis_period_chk'
  ) THEN
    ALTER TABLE staff_kpis
      ADD CONSTRAINT staff_kpis_period_chk
      CHECK (period IN ('week', 'month', 'quarter', 'half', 'year'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_kpis_status_chk'
  ) THEN
    ALTER TABLE staff_kpis
      ADD CONSTRAINT staff_kpis_status_chk
      CHECK (status IN
        ('active', 'paused', 'achieved', 'missed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_kpis_target_chk'
  ) THEN
    ALTER TABLE staff_kpis
      ADD CONSTRAINT staff_kpis_target_chk
      CHECK (target_value > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS staff_kpis_tenant_member
  ON staff_kpis (tenant_id, staff_member_id, status);

-- -----------------------------------------------------------------------------
-- §3 — org_tasks   (e.g. "weekly pit-wall inspection scheduling").
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_tasks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  title               text        NOT NULL,
  description         text,
  assigned_to         uuid        REFERENCES staff_members(id) ON DELETE SET NULL,
  assigned_by_user_id text,
  status              text        NOT NULL DEFAULT 'open',
  priority            text        NOT NULL DEFAULT 'normal',
  due_at              timestamptz,
  completed_at        timestamptz,
  origin_session_id   text,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_tasks_status_chk'
  ) THEN
    ALTER TABLE org_tasks
      ADD CONSTRAINT org_tasks_status_chk
      CHECK (status IN ('open', 'in_progress', 'done', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_tasks_priority_chk'
  ) THEN
    ALTER TABLE org_tasks
      ADD CONSTRAINT org_tasks_priority_chk
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_tasks_title_chk'
  ) THEN
    ALTER TABLE org_tasks
      ADD CONSTRAINT org_tasks_title_chk
      CHECK (char_length(title) BETWEEN 1 AND 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS org_tasks_tenant_status
  ON org_tasks (tenant_id, status, due_at);

CREATE INDEX IF NOT EXISTS org_tasks_tenant_assigned
  ON org_tasks (tenant_id, assigned_to);

-- -----------------------------------------------------------------------------
-- §4 — org_escalations  ("compliance breach / safety incident / payment
-- default").
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_escalations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  title                 text        NOT NULL,
  reason                text        NOT NULL,
  category              text        NOT NULL DEFAULT 'other',
  severity              text        NOT NULL DEFAULT 'normal',
  status                text        NOT NULL DEFAULT 'open',
  escalated_to_staff_id uuid        REFERENCES staff_members(id) ON DELETE SET NULL,
  related_task_id       uuid        REFERENCES org_tasks(id) ON DELETE SET NULL,
  related_subject       text,
  raised_by_user_id     text,
  origin_session_id     text,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance            jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_escalations_severity_chk'
  ) THEN
    ALTER TABLE org_escalations
      ADD CONSTRAINT org_escalations_severity_chk
      CHECK (severity IN ('low', 'normal', 'high', 'critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_escalations_status_chk'
  ) THEN
    ALTER TABLE org_escalations
      ADD CONSTRAINT org_escalations_status_chk
      CHECK (status IN
        ('open', 'acknowledged', 'in_progress', 'resolved', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_escalations_category_chk'
  ) THEN
    ALTER TABLE org_escalations
      ADD CONSTRAINT org_escalations_category_chk
      CHECK (category IN
        ('compliance_breach', 'safety_incident', 'payment_default', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS org_escalations_tenant_status
  ON org_escalations (tenant_id, status, severity);

-- -----------------------------------------------------------------------------
-- §5 — FORCE RLS + tenant-isolation policies on the CANONICAL GUC.
--
-- tenant_id is TEXT so the compare is bare (no cast). FOR ALL covers INSERT,
-- the assign / schedule / escalate UPDATE, and the list / read SELECT.
-- Idempotent: ENABLE / FORCE are no-ops if already set; each policy is created
-- only if absent.
-- -----------------------------------------------------------------------------

ALTER TABLE staff_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members   FORCE  ROW LEVEL SECURITY;
ALTER TABLE staff_kpis      ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_kpis      FORCE  ROW LEVEL SECURITY;
ALTER TABLE org_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_tasks       FORCE  ROW LEVEL SECURITY;
ALTER TABLE org_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_escalations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'staff_members'
       AND policyname = 'staff_members_tenant_isolation'
  ) THEN
    CREATE POLICY staff_members_tenant_isolation
      ON staff_members
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'staff_kpis'
       AND policyname = 'staff_kpis_tenant_isolation'
  ) THEN
    CREATE POLICY staff_kpis_tenant_isolation
      ON staff_kpis
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'org_tasks'
       AND policyname = 'org_tasks_tenant_isolation'
  ) THEN
    CREATE POLICY org_tasks_tenant_isolation
      ON org_tasks
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'org_escalations'
       AND policyname = 'org_escalations_tenant_isolation'
  ) THEN
    CREATE POLICY org_escalations_tenant_isolation
      ON org_escalations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- anon is a Supabase construct; guard so the migration still applies on a
-- vanilla Postgres (CI empty-PG check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.staff_members FROM anon;';
    EXECUTE 'REVOKE ALL ON public.staff_kpis FROM anon;';
    EXECUTE 'REVOKE ALL ON public.org_tasks FROM anon;';
    EXECUTE 'REVOKE ALL ON public.org_escalations FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE staff_members IS
  'Org staff member (migration 0280; ported from the BN org/team-management '
  'stack, retargeted real-estate -> mining: caretaker / leasing_assistant -> '
  'site_supervisor / pit_foreman / safety_officer / geologist / accountant). '
  'Tenant-scoped FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE staff_kpis IS
  'KPI target assigned to a staff member (migration 0280). Metric units are '
  'domain-neutral (count / currency / percent / days / hours / ratio); a money '
  'KPI uses metric_unit=currency with NO jurisdiction code in this layer. '
  'Tenant-scoped FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE org_tasks IS
  'Org task scheduled to (optionally) a staff member (migration 0280; e.g. '
  '"weekly pit-wall inspection"). Tenant-scoped FORCE RLS on the canonical '
  'app.current_tenant_id GUC.';

COMMENT ON TABLE org_escalations IS
  'Escalation raised for a human to act on (migration 0280; compliance_breach '
  '/ safety_incident / payment_default / other). Tenant-scoped FORCE RLS on '
  'the canonical app.current_tenant_id GUC.';

COMMIT;
