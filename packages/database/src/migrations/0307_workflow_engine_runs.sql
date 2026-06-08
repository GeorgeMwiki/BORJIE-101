-- =============================================================================
-- Migration 0307 — workflow-engine durable persistence
--                  (workflow_runs · workflow_run_events · workflow_audit_chain).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/workflow-engine` is the maker-checker / four-eyes spine: it converts
-- a worker's intent (e.g. "redraw this parcel polygon", "approve this PO") into
-- an audited lifecycle — open → in_progress → in_review → in_approval →
-- committed | rejected | cancelled. The api-gateway wires it at
-- `composition/workflow-engine-wiring.ts` and mounts it on `/workflow`, but EVERY
-- repository was in-memory (`createInMemoryRunRepository` et al.). So every
-- `/workflow` run, the four-eyes APPROVAL QUEUE (runs sitting in `in_approval`),
-- and the "append-only" hashed AUDIT CHAIN were lost on any api-gateway restart —
-- silently breaking the SOC2 CC7.2 durability + tamper-evidence claim
-- (see EXECUTION_SPEC_WAVES23.md L16 + execution-architecture-audit EX-10).
--
-- This migration stands up the three Postgres-backed tables behind the engine's
-- three persistence ports. Drizzle adapters in
-- `packages/workflow-engine/src/runs/drizzle-repos.ts` implement
-- WorkflowRunRepository / WorkflowRunEventRepository / AuditChainRepository
-- against these tables; the composition root selects them when a DB is present
-- and keeps the in-memory fallback otherwise.
--
-- SHAPE / MAPPING ONTO THE PORTS
-- ------------------------------
-- workflow_runs        ← WorkflowRun. The lifecycle projection. Nested value
--                        objects (input / proposed_change / review_decision /
--                        approval_decision) are stored as jsonb; the engine
--                        already treats them as immutable frozen records.
--                        `assigned_approver_user_id` + state='in_approval' IS
--                        the four-eyes approval queue.
-- workflow_run_events  ← WorkflowRunEvent. Append-only event log; the run state
--                        is a projection of this log.
-- workflow_audit_chain ← AuditChainEntry. SHA-256 hash chain (previous_hash →
--                        current_hash) for tamper-evident SOC2/GDPR ordering.
--                        UNIQUE(tenant_id, current_hash) makes the per-tenant
--                        head pointer (latestHashForTenant) deterministic.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors migrations 0289 / 0295 / 0302):
--   tenant_id is TEXT and FK→tenants; every table FORCE-enables row-level
--   security with a tenant-isolation policy on the canonical
--   `app.current_tenant_id` GUC. Bare compare (no cast). NEVER the legacy
--   `app.tenant_id`. The engine's `findById(runId)` / `getRun(runId)` are
--   globally-unique-by-id reads the caller verifies against `run.tenantId`
--   (see workflow-engine engine.ts loadOrThrow nosemgrep notes); the Drizzle
--   adapter runs those under a service-role context so RLS does not need a
--   tenant hint it does not have, while every write + every queue read binds
--   the concrete tenant GUC.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
--   CREATE TABLE / INDEX IF NOT EXISTS + guarded DO-blocks, plus a pg_roles
--   guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
--   References only pre-existing infra (`tenants`, pgcrypto). No NOT NULL is
--   added to an existing-data table (all NOT NULLs are on freshly-created
--   columns), so the NOT-NULL-backfill validator is satisfied.
--
-- Companion files:
--   * packages/database/src/schemas/workflow-engine.schema.ts
--   * packages/workflow-engine/src/runs/drizzle-repos.ts
--   * services/api-gateway/src/composition/workflow-engine-wiring.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- workflow_runs — the lifecycle projection (one row per run).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_runs (
  id                         text        PRIMARY KEY,
  tenant_id                  text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id              text        NOT NULL,
  kind                       text        NOT NULL,
  scope                      text        NOT NULL,
  scope_ref                  text        NOT NULL,
  initiated_by_user_id       text        NOT NULL,
  assigned_reviewer_user_id  text,
  assigned_approver_user_id  text,
  state                      text        NOT NULL,
  input                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Nested value objects (ProposedChange / ReviewDecision / ApprovalDecision).
  -- null until the corresponding lifecycle step fires.
  proposed_change            jsonb,
  review_decision            jsonb,
  approval_decision          jsonb,
  rejection_reason           text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  committed_at               timestamptz
);

-- myQueue: runs a given user initiated, within a tenant.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_initiator
  ON workflow_runs (tenant_id, initiated_by_user_id);

-- reviewQueue / approvalQueue: runs in a given state, within a tenant.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_state
  ON workflow_runs (tenant_id, state);

-- -----------------------------------------------------------------------------
-- workflow_run_events — append-only per-run event log.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_run_events (
  id             text        PRIMARY KEY,
  run_id         text        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id      text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  actor_user_id  text,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

-- listForRun: ordered replay of a run's events.
CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run
  ON workflow_run_events (run_id, occurred_at);

-- -----------------------------------------------------------------------------
-- workflow_audit_chain — tamper-evident SHA-256 hash chain (SOC2 CC7.2).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_audit_chain (
  id               text        PRIMARY KEY,
  run_id           text        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id        text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  previous_hash    text        NOT NULL,
  current_hash     text        NOT NULL,
  recorded_kind    text        NOT NULL,
  recorded_payload jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

-- latestHashForTenant reads the most-recent entry per tenant; listForRun reads
-- a single run's entries in time order.
CREATE INDEX IF NOT EXISTS idx_workflow_audit_chain_tenant_recorded
  ON workflow_audit_chain (tenant_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_workflow_audit_chain_run
  ON workflow_audit_chain (run_id, recorded_at);

-- A tenant's chain head is unambiguous: no two entries share a current_hash.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_audit_chain_tenant_hash_uq'
  ) THEN
    ALTER TABLE workflow_audit_chain
      ADD CONSTRAINT workflow_audit_chain_tenant_hash_uq
      UNIQUE (tenant_id, current_hash);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (all three tables).
-- -----------------------------------------------------------------------------

ALTER TABLE workflow_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs        FORCE  ROW LEVEL SECURITY;
ALTER TABLE workflow_run_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_events  FORCE  ROW LEVEL SECURITY;
ALTER TABLE workflow_audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_audit_chain FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_runs'
       AND policyname = 'workflow_runs_tenant_isolation'
  ) THEN
    CREATE POLICY workflow_runs_tenant_isolation
      ON workflow_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_run_events'
       AND policyname = 'workflow_run_events_tenant_isolation'
  ) THEN
    CREATE POLICY workflow_run_events_tenant_isolation
      ON workflow_run_events
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_audit_chain'
       AND policyname = 'workflow_audit_chain_tenant_isolation'
  ) THEN
    CREATE POLICY workflow_audit_chain_tenant_isolation
      ON workflow_audit_chain
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Service-role bypass — globally-unique-by-id reads (findById/getRun) +
-- cross-tenant verification chain walks run under withServiceRoleContext, which
-- sets app.is_service_role='true'. Mirror the 0179 bypass-policy shape so those
-- system reads are permitted without a tenant GUC hint they do not have. The
-- per-write + per-queue paths still bind the concrete tenant GUC.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_runs'
       AND policyname = 'workflow_runs_service_role_bypass'
  ) THEN
    CREATE POLICY workflow_runs_service_role_bypass
      ON workflow_runs
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_run_events'
       AND policyname = 'workflow_run_events_service_role_bypass'
  ) THEN
    CREATE POLICY workflow_run_events_service_role_bypass
      ON workflow_run_events
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_audit_chain'
       AND policyname = 'workflow_audit_chain_service_role_bypass'
  ) THEN
    CREATE POLICY workflow_audit_chain_service_role_bypass
      ON workflow_audit_chain
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.workflow_runs FROM anon;';
    EXECUTE 'REVOKE ALL ON public.workflow_run_events FROM anon;';
    EXECUTE 'REVOKE ALL ON public.workflow_audit_chain FROM anon;';
  END IF;
END $$;

COMMIT;
