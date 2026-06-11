-- =============================================================================
-- Migration 0341 — org_loop_runs: the SELF-RUNNING-ORG SPINE correlation
-- identity (the durable join between an md_commitment and the mining_task it
-- spawned, plus the stage/status of each closed-loop run).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The self-running-org loop is the closed chain where Mr. Mwikila detects a gap
-- → strategizes → picks the right workforce person → assigns a task → it reaches
-- them in-app → they are guided → completion closes the originating commitment →
-- the matcher learns. The chain ENDS are already live (detect-gap, flag-owner,
-- guide-assist, report-progress) but the MIDDLE was dark: there was no durable
-- identity that JOINS the originating `md_commitments` row (migration 0321) to
-- the `mining_tasks` row the orchestrator spawned, nor a record of WHICH stage a
-- given loop run is in. Without that join the loop cannot be re-read, resumed,
-- or closed: a worker completing a task could never reach back to the commitment
-- that asked for it, and the matcher could never learn from the run.
--
-- This table is that identity. One durable row per loop RUN. It carries the
-- correlation (commitment_id ↔ task_id), the stage machine (detect → strategize
-- → pick → assign → dispatch → deliver → report → reloop → closed), the honest
-- status (open | active | closed | failed), the chosen employee + match
-- confidence (so the matcher can learn), and the evidence ids threaded from the
-- originating commitment (the CLAUDE.md evidence-required hard rule travels with
-- the loop). The loop ENGINE is universal Mr-Mwikila core; the loop CONTENT
-- (loop_kind, stage, source_data) is domain-pack DATA — this row is the
-- declarative substrate the loop-economy LoopSpec composes over, never a
-- hardcoded per-vertical branch.
--
-- ONE TABLE
--   * org_loop_runs — one durable row per loop run. `stage` is the stage machine
--     position; `status` is the honest lifecycle. `commitment_id` ties the run
--     to its originating `md_commitments` row (the close-the-loop back-edge);
--     `task_id` ties it to the spawned `mining_tasks` row (the dispatch
--     forward-edge). `strategy_json` carries the strategize step's plan;
--     `chosen_employee_id` + `match_confidence` carry the pick step's decision
--     (the matcher-learning inputs). `source_data` + `evidence_ids` carry the
--     detect step's grounding (evidence-required threads through the loop).
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as md_commitments / md_commitment_timeline / situational_model).
-- FORCE ROW LEVEL SECURITY with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC PLUS a service-role bypass (mirroring 0321 / 0339)
-- so the out-of-band loop-economy cron / reconcile sweep can read + advance loop
-- runs while RLS FORCE still isolates every request path. Guarded anon REVOKE.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is on
-- a freshly-created column (no backfill hazard) so the NOT-NULL safety validator
-- passes.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/org-loop-runs.ts
--   * packages/database/src/repositories/org-loop-run-repository.ts
--   * packages/database/src/migrations/down/0341_org_loop_runs.down.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS org_loop_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL,
  -- The originating md_commitments.id this loop run closes (the back-edge). No
  -- FK: same tenant-scoped, FK-free convention as md_commitments itself.
  commitment_id      text        NOT NULL,
  -- WHICH universal loop this is (loop-economy LoopSpec id). Domain-pack DATA,
  -- not a hardcoded branch — the spine registers as 'gap_to_delegate'.
  loop_kind          text        NOT NULL DEFAULT 'gap_to_delegate',
  -- The stage-machine position. detect → strategize → pick → assign → dispatch
  -- → deliver → report → reloop → closed.
  stage              text        NOT NULL DEFAULT 'strategize',
  -- The honest lifecycle: open | active | closed | failed.
  status             text        NOT NULL DEFAULT 'open',
  -- The loop-economy drive that fired this run (nullable — a run may be born
  -- from a direct commitment, not a drive).
  drive_id           text,
  -- The strategize step's plan (serialised strategy the MD composed).
  strategy_json      jsonb,
  -- The pick step's decision — the chosen workforce person (matcher output).
  chosen_employee_id text,
  -- The matcher's confidence in that pick (the learning signal; 0..1).
  match_confidence   numeric,
  -- The spawned mining_tasks.id this loop run dispatched (the forward-edge). No
  -- FK: same tenant-scoped, FK-free convention.
  task_id            text,
  -- The detect step's grounding payload (gap snapshot, drive context, ...).
  source_data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Evidence-required hard rule: the evidence ids threaded from the commitment.
  evidence_ids       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_loop_runs_stage_chk CHECK (
    stage IN (
      'detect', 'strategize', 'pick', 'assign', 'dispatch',
      'deliver', 'report', 'reloop', 'closed'
    )
  ),
  CONSTRAINT org_loop_runs_status_chk CHECK (
    status IN ('open', 'active', 'closed', 'failed')
  )
);

-- Dispatch back-reference: a worker completing a task reaches back to its loop
-- run (the close-the-loop edge resolves task_id → run → commitment).
CREATE INDEX IF NOT EXISTS org_loop_runs_task_idx
  ON org_loop_runs (tenant_id, task_id);

-- Commitment forward-reference: the loop dispatcher finds the live run for a
-- commitment (de-dupe / resume), and close-the-loop finds runs by commitment.
CREATE INDEX IF NOT EXISTS org_loop_runs_commitment_idx
  ON org_loop_runs (tenant_id, commitment_id);

-- The loop-economy cron's hot scan: open/active runs by stage for a tenant.
CREATE INDEX IF NOT EXISTS org_loop_runs_status_stage_idx
  ON org_loop_runs (tenant_id, status, stage);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band loop-economy cron / reconcile sweep) + guarded anon REVOKE.
-- Mirrors the 0321 / 0339 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'org_loop_runs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
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

COMMENT ON TABLE org_loop_runs IS
  'The self-running-org SPINE correlation identity — one durable row per loop '
  'run joining an md_commitments row (commitment_id, the close-the-loop '
  'back-edge) to the mining_tasks row it spawned (task_id, the dispatch '
  'forward-edge). Carries the stage machine (detect → strategize → pick → '
  'assign → dispatch → deliver → report → reloop → closed), honest status, the '
  'chosen employee + match confidence (matcher-learning inputs), and the '
  'evidence ids threaded from the commitment. The loop ENGINE is universal '
  'Mr-Mwikila core; loop_kind/stage/source_data are domain-pack DATA. FORCE RLS '
  'on app.current_tenant_id + service-role bypass for the out-of-band cron.';

COMMIT;
