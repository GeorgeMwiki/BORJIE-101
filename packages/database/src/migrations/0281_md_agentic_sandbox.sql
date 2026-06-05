-- =============================================================================
-- Migration 0281 — Agentic plan / subagent + sandbox-preview write surface.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Ported from the BN md-agentic stack (itself a LitFin iter-32 plan-mode +
-- iter-36 agent-teams / sandbox-writes port), retargeted real-estate →
-- mining. Brings Mr. Mwikila to Claude-Code-parity "plan mode" + "agent
-- teams" + a worktree-style sandbox: the brain STAGES a mutation in a sandbox
-- table, the owner reviews the payload + rationale, then commits (atomic write
-- to the real table + an append-only audit row) or rejects (rejection log).
-- NOTHING the brain stages reaches a real table until the owner commits.
--
-- Backs the `plan.*` / `sandbox.*` brain tools (md-agentic-tools.ts) and the
-- `/api/v1/md-agentic/*` route surface. Split into five tables so the commit
-- log + reject log are append-only siblings of the pending-writes table
-- (audit-chain discipline):
--   md_plans            - one row per proposed multi-step plan
--   md_subagent_runs    - one row per dispatched subagent (honest-degrade:
--                          persisted with status='pending'; aggregate reads
--                          persisted results, NEVER fabricates output)
--   md_sandbox_writes   - one row per STAGED mutation awaiting owner review
--   md_sandbox_commits  - append-only audit row written when a sandbox write
--                          is committed to its real target table
--   md_sandbox_rejects  - append-only rejection log
--
-- TOOLS BACKED:
--   plan.propose / plan.dispatch_subagents / plan.aggregate_results /
--   sandbox.write / sandbox.commit / sandbox.reject / sandbox.list.
--
-- SANDBOX TARGET ALLOWLIST (mirrored as a CHECK constraint): the gap-2
-- org/team tables only — staff_members / staff_kpis / org_tasks /
-- org_escalations (migration 0280). Every one is tenant-scoped + FORCE-RLS, so
-- a committed write lands inside the same isolation boundary. The commit path
-- additionally validates the payload (zod shape + FK existence) BEFORE the
-- atomic real-table write.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): NOTHING here hard-codes a
-- jurisdiction currency. A staged payload that carries money is opaque JSONB
-- validated at commit time by the route layer; no currency code lives here.
-- NEVER hard-code TZS/KES/UGX/NGN.
--
-- FRESH-DB SAFETY / IDEMPOTENCY
-- -----------------------------
-- Every statement is guarded: CREATE TABLE IF NOT EXISTS, DO-blocks that check
-- pg_constraint / pg_policies before ADD CONSTRAINT / CREATE POLICY, CREATE
-- INDEX IF NOT EXISTS, and a pg_roles guard around the anon REVOKE. On a
-- fully-migrated DB this is a pure no-op; on a FRESH or partially-applied DB it
-- stands the tables up correctly secured. md_subagent_runs + md_sandbox_writes
-- FK to md_plans with ON DELETE SET NULL so deleting a plan never cascade-
-- destroys forensic run / sandbox history. The sandbox commit / reject logs FK
-- to md_sandbox_writes with ON DELETE CASCADE (a sandbox write and its own
-- audit rows live + die together).
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped tables -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (the canonical GUC the
--     api-gateway databaseMiddleware binds). tenant_id is TEXT so the compare
--     is bare (no cast). NEVER the legacy app.tenant_id.
--   * REVOKE anon, guarded for vanilla Postgres / CI empty-PG (anon is a
--     Supabase-only role).
--   * Migrations are immutable + forward-only: this APPENDS a new numbered file
--     (next after 0280); it edits no shipped migration. Safe to re-run.
--
-- Companion files:
--   - packages/database/src/migrations/down/0281_down_md_agentic_sandbox.sql
--   - packages/database/src/schemas/md-agentic.schema.ts
--   - services/api-gateway/src/composition/md-agentic-repository.ts
--   - services/api-gateway/src/composition/md-sandbox-payload.ts
--   - services/api-gateway/src/routes/md-agentic.hono.ts
--   - services/api-gateway/src/composition/brain-tools/md-agentic-tools.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- §1 — md_plans   (Claude-Code-parity "plan mode" -- proposal only, no exec).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_plans (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  title                text        NOT NULL,
  summary              text        NOT NULL,
  steps                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact     text,
  status               text        NOT NULL DEFAULT 'proposed',
  proposed_by_user_id  text,
  origin_session_id    text,
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance           jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_plans_status_chk'
  ) THEN
    ALTER TABLE md_plans
      ADD CONSTRAINT md_plans_status_chk
      CHECK (status IN
        ('proposed', 'approved', 'rejected', 'executing', 'completed',
         'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_plans_title_chk'
  ) THEN
    ALTER TABLE md_plans
      ADD CONSTRAINT md_plans_title_chk
      CHECK (char_length(title) BETWEEN 1 AND 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS md_plans_tenant_status
  ON md_plans (tenant_id, status, created_at DESC);

-- -----------------------------------------------------------------------------
-- §2 — md_subagent_runs   (Agent-Teams primitive -- honest-degraded).
--
-- One row per dispatched subagent. dispatch persists rows at status 'pending';
-- an executor (when wired) flips them to 'completed' / 'failed' and writes
-- `result`. aggregate reads `result` -- it NEVER fabricates output. With no
-- executor wired the team stays 'pending' and aggregate honestly reports
-- 'unavailable'.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_subagent_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  team_run_id         uuid        NOT NULL,
  plan_id             uuid        REFERENCES md_plans(id) ON DELETE SET NULL,
  role                text        NOT NULL,
  brief               text        NOT NULL,
  allowed_tools       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  token_budget        integer     NOT NULL DEFAULT 0,
  aggregation         text        NOT NULL DEFAULT 'merge_all',
  status              text        NOT NULL DEFAULT 'pending',
  result              jsonb,
  error               text,
  spawned_by_user_id  text,
  origin_session_id   text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_subagent_runs_role_chk'
  ) THEN
    ALTER TABLE md_subagent_runs
      ADD CONSTRAINT md_subagent_runs_role_chk
      CHECK (role IN
        ('explorer', 'reviewer', 'synthesizer', 'researcher', 'executor'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_subagent_runs_status_chk'
  ) THEN
    ALTER TABLE md_subagent_runs
      ADD CONSTRAINT md_subagent_runs_status_chk
      CHECK (status IN
        ('pending', 'running', 'completed', 'failed', 'cancelled',
         'budget_exceeded', 'unavailable'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_subagent_runs_aggregation_chk'
  ) THEN
    ALTER TABLE md_subagent_runs
      ADD CONSTRAINT md_subagent_runs_aggregation_chk
      CHECK (aggregation IN
        ('majority_vote', 'best_of_n', 'merge_all', 'first_success'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_subagent_runs_budget_chk'
  ) THEN
    ALTER TABLE md_subagent_runs
      ADD CONSTRAINT md_subagent_runs_budget_chk
      CHECK (token_budget >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS md_subagent_runs_tenant_team
  ON md_subagent_runs (tenant_id, team_run_id, status);

CREATE INDEX IF NOT EXISTS md_subagent_runs_tenant_status
  ON md_subagent_runs (tenant_id, status, created_at DESC);

-- -----------------------------------------------------------------------------
-- §3 — md_sandbox_writes   (the STAGED mutation awaiting owner review).
--
-- target_table is constrained to the gap-2 org/team tables (mig 0280).
-- proposed_payload is opaque JSONB validated at COMMIT time by the route layer
-- (zod shape + FK existence) before the atomic real-table write.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_sandbox_writes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  target_table        text        NOT NULL,
  operation           text        NOT NULL,
  target_row_id       uuid,
  proposed_payload    jsonb       NOT NULL,
  rationale           text,
  status              text        NOT NULL DEFAULT 'pending',
  plan_id             uuid        REFERENCES md_plans(id) ON DELETE SET NULL,
  proposed_by_user_id text,
  origin_session_id   text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_sandbox_writes_target_chk'
  ) THEN
    ALTER TABLE md_sandbox_writes
      ADD CONSTRAINT md_sandbox_writes_target_chk
      CHECK (target_table IN
        ('staff_members', 'staff_kpis', 'org_tasks', 'org_escalations'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_sandbox_writes_operation_chk'
  ) THEN
    ALTER TABLE md_sandbox_writes
      ADD CONSTRAINT md_sandbox_writes_operation_chk
      CHECK (operation IN ('insert', 'update'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_sandbox_writes_status_chk'
  ) THEN
    ALTER TABLE md_sandbox_writes
      ADD CONSTRAINT md_sandbox_writes_status_chk
      CHECK (status IN ('pending', 'committed', 'rejected', 'expired'));
  END IF;

  -- An UPDATE must name the row it targets; an INSERT must not.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_sandbox_writes_update_target_chk'
  ) THEN
    ALTER TABLE md_sandbox_writes
      ADD CONSTRAINT md_sandbox_writes_update_target_chk
      CHECK (
        (operation = 'update' AND target_row_id IS NOT NULL) OR
        (operation = 'insert' AND target_row_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS md_sandbox_writes_tenant_status
  ON md_sandbox_writes (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS md_sandbox_writes_tenant_table
  ON md_sandbox_writes (tenant_id, target_table, status);

-- -----------------------------------------------------------------------------
-- §4 — md_sandbox_commits   (append-only audit log of committed writes).
--
-- One row per successful commit. Captures the committed target row id and the
-- pre-commit snapshot (for UPDATE -> rollback evidence). FK to the sandbox
-- write with ON DELETE CASCADE.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_sandbox_commits (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  sandbox_write_id    uuid        NOT NULL
                        REFERENCES md_sandbox_writes(id) ON DELETE CASCADE,
  target_table        text        NOT NULL,
  operation           text        NOT NULL,
  target_row_id       uuid,
  pre_commit_snapshot jsonb,
  committed_payload   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  committed_by_user_id text,
  origin_session_id   text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS md_sandbox_commits_tenant_write
  ON md_sandbox_commits (tenant_id, sandbox_write_id);

CREATE INDEX IF NOT EXISTS md_sandbox_commits_tenant_created
  ON md_sandbox_commits (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- §5 — md_sandbox_rejects   (append-only rejection log).
--
-- One row per rejected sandbox write, carrying the owner's reason. The real
-- target table is NEVER touched. FK to the sandbox write with ON DELETE
-- CASCADE.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_sandbox_rejects (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  sandbox_write_id    uuid        NOT NULL
                        REFERENCES md_sandbox_writes(id) ON DELETE CASCADE,
  target_table        text        NOT NULL,
  reason              text        NOT NULL,
  rejected_by_user_id text,
  origin_session_id   text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'md_sandbox_rejects_reason_chk'
  ) THEN
    ALTER TABLE md_sandbox_rejects
      ADD CONSTRAINT md_sandbox_rejects_reason_chk
      CHECK (char_length(reason) BETWEEN 1 AND 4000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS md_sandbox_rejects_tenant_write
  ON md_sandbox_rejects (tenant_id, sandbox_write_id);

CREATE INDEX IF NOT EXISTS md_sandbox_rejects_tenant_created
  ON md_sandbox_rejects (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- §6 — FORCE RLS + tenant-isolation policies on the CANONICAL GUC.
--
-- tenant_id is TEXT so the compare is bare (no cast). FOR ALL covers the
-- propose / dispatch / stage INSERT, the commit / reject UPDATE, and the
-- list / aggregate SELECT. Idempotent: ENABLE / FORCE are no-ops if already
-- set; each policy is created only if absent.
-- -----------------------------------------------------------------------------

ALTER TABLE md_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_plans           FORCE  ROW LEVEL SECURITY;
ALTER TABLE md_subagent_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_subagent_runs   FORCE  ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_writes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_writes  FORCE  ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_commits FORCE  ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_rejects ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_sandbox_rejects FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'md_plans'
       AND policyname = 'md_plans_tenant_isolation'
  ) THEN
    CREATE POLICY md_plans_tenant_isolation
      ON md_plans
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'md_subagent_runs'
       AND policyname = 'md_subagent_runs_tenant_isolation'
  ) THEN
    CREATE POLICY md_subagent_runs_tenant_isolation
      ON md_subagent_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'md_sandbox_writes'
       AND policyname = 'md_sandbox_writes_tenant_isolation'
  ) THEN
    CREATE POLICY md_sandbox_writes_tenant_isolation
      ON md_sandbox_writes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'md_sandbox_commits'
       AND policyname = 'md_sandbox_commits_tenant_isolation'
  ) THEN
    CREATE POLICY md_sandbox_commits_tenant_isolation
      ON md_sandbox_commits
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'md_sandbox_rejects'
       AND policyname = 'md_sandbox_rejects_tenant_isolation'
  ) THEN
    CREATE POLICY md_sandbox_rejects_tenant_isolation
      ON md_sandbox_rejects
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
    EXECUTE 'REVOKE ALL ON public.md_plans FROM anon;';
    EXECUTE 'REVOKE ALL ON public.md_subagent_runs FROM anon;';
    EXECUTE 'REVOKE ALL ON public.md_sandbox_writes FROM anon;';
    EXECUTE 'REVOKE ALL ON public.md_sandbox_commits FROM anon;';
    EXECUTE 'REVOKE ALL ON public.md_sandbox_rejects FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE md_plans IS
  'Proposed multi-step plan (migration 0281; Claude-Code-parity plan mode, '
  'ported from BN md-agentic). Proposal only — execution stays governed '
  'step-by-step through the normal tier-policy pipeline. Tenant-scoped FORCE '
  'RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE md_subagent_runs IS
  'Dispatched subagent run (migration 0281; agent-teams primitive). HONEST-'
  'DEGRADE: persisted at status=pending; an executor (when wired) writes '
  'result, which aggregate reads — output is NEVER fabricated. Tenant-scoped '
  'FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE md_sandbox_writes IS
  'Staged sandbox mutation awaiting owner review (migration 0281). '
  'target_table is constrained to the gap-2 org/team tables (mig 0280); the '
  'opaque JSONB payload is validated at commit time (zod + FK) before the '
  'atomic real-table write. Tenant-scoped FORCE RLS on the canonical '
  'app.current_tenant_id GUC.';

COMMENT ON TABLE md_sandbox_commits IS
  'Append-only audit row written when a sandbox write commits to its real '
  'target table (migration 0281). Captures the pre-commit snapshot for '
  'UPDATE rollback evidence. Tenant-scoped FORCE RLS on the canonical '
  'app.current_tenant_id GUC.';

COMMENT ON TABLE md_sandbox_rejects IS
  'Append-only rejection log for a rejected sandbox write (migration 0281). '
  'The real target table is NEVER touched. Tenant-scoped FORCE RLS on the '
  'canonical app.current_tenant_id GUC.';

COMMIT;
