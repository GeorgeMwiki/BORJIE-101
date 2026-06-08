-- =============================================================================
-- Migration 0307 — CREATE the workflow-engine durable persistence family so the
-- /workflow runs, the four-eyes approval queue, and the append-only hashed
-- audit chain SURVIVE an api-gateway restart.
--
-- Before this migration the @borjie/workflow-engine repositories were wired to
-- in-memory adapters in services/api-gateway/src/composition/workflow-engine-
-- wiring.ts (createInMemoryRunRepository / ...RunEventRepository /
-- ...AuditChainRepository). Every workflow run, every queued four-eyes approval,
-- and every "append-only" audit-chain entry was lost on process restart —
-- which makes the SOC 2 CC7.2 audit-trail claim false (see
-- Docs/research/borjie-execution-architecture-audit.md EX-10). This migration
-- lands the three Drizzle-backed tables those repositories now persist to.
--
-- The three tables mirror, COLUMN-FOR-COLUMN, the engine's public types
-- (packages/workflow-engine/src/types.ts):
--   * workflow_runs        ← WorkflowRun        (the run + its embedded
--                            proposed-change / review / approval decisions,
--                            stored as jsonb projections of the event log).
--   * workflow_run_events  ← WorkflowRunEvent   (append-only transition log).
--   * workflow_audit_chain ← AuditChainEntry    (hashed, per-tenant linear
--                            chain — previous_hash → current_hash).
-- The "approval queue" is NOT a separate table: it is the subset of
-- workflow_runs whose state = 'in_approval' (the engine's listApprovalQueue
-- reads exactly that), so no extra table is needed.
--
-- RLS (CLAUDE.md hard rule — FORCE on every tenant-scoped table). The CANONICAL
-- pattern in this repo is `current_setting('app.current_tenant_id', true)` with
-- BOTH ENABLE and FORCE ROW LEVEL SECURITY (see migrations 0297 + 0306). The
-- api-gateway binds ONLY `app.current_tenant_id` per request transaction
-- (packages/database/src/rls/with-tenant-context.ts); the Drizzle workflow
-- repositories run every query inside withTenantContext / withServiceRoleContext
-- so the GUC is always set. All three tables are STRICTLY tenant-scoped
-- (tenant_id = guc); there are no platform-shared rows.
--
-- IDEMPOTENT / FRESH-DB SAFE: every statement is CREATE ... IF NOT EXISTS or a
-- guarded DO-block (pg_policies / pg_roles). Re-running is a no-op. No NOT NULL
-- column is ever added to an existing table (all NOT NULL columns are declared
-- inside the CREATE TABLE of a brand-new table, so the migration-safety
-- validator classifies them NEW_TABLE-safe), and the RLS DO-blocks contain no
-- constraint-shaped NOT NULL (only the RLS predicates), so this file does NOT
-- need the `-- @safety: dynamic-not-null-reviewed` allowlist comment.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. workflow_runs — the run aggregate. (matches workflow-runs.schema.ts +
--    packages/workflow-engine/src/types.ts WorkflowRun)
--    The proposed-change / review-decision / approval-decision sub-objects are
--    stored as jsonb so the run row is a single self-contained projection of
--    the append-only event log. state drives both the review queue
--    (state='in_review') and the four-eyes approval queue (state='in_approval').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"                          text PRIMARY KEY NOT NULL,
  "tenant_id"                   text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "definition_id"               text NOT NULL,
  "kind"                        text NOT NULL,
  "scope"                       text NOT NULL,
  "scope_ref"                   text NOT NULL,
  "initiated_by_user_id"        text NOT NULL,
  "assigned_reviewer_user_id"   text,
  "assigned_approver_user_id"   text,
  "state"                       text NOT NULL DEFAULT 'open',
  "input"                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposed_change"             jsonb,
  "review_decision"             jsonb,
  "approval_decision"           jsonb,
  "rejection_reason"            text,
  "created_at"                  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                  timestamp with time zone NOT NULL DEFAULT now(),
  "committed_at"                timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_idx"          ON "workflow_runs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_state_idx"    ON "workflow_runs" ("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_initiator_idx" ON "workflow_runs" ("tenant_id", "initiated_by_user_id");
CREATE INDEX IF NOT EXISTS "workflow_runs_review_queue_idx"     ON "workflow_runs" ("tenant_id") WHERE "state" = 'in_review';
CREATE INDEX IF NOT EXISTS "workflow_runs_approval_queue_idx"   ON "workflow_runs" ("tenant_id") WHERE "state" = 'in_approval';

-- ---------------------------------------------------------------------------
-- 2. workflow_run_events — append-only transition log. (matches
--    workflow-run-events.schema.ts + WorkflowRunEvent)
--    One row per state transition; never updated, never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "workflow_run_events" (
  "id"             text PRIMARY KEY NOT NULL,
  "run_id"         text NOT NULL,
  "tenant_id"      text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind"           text NOT NULL,
  "actor_user_id"  text,
  "payload"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at"    timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workflow_run_events_run_idx"    ON "workflow_run_events" ("run_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "workflow_run_events_tenant_idx" ON "workflow_run_events" ("tenant_id");

-- ---------------------------------------------------------------------------
-- 3. workflow_audit_chain — hashed, per-tenant linear chain. (matches
--    workflow-audit-chain.schema.ts + AuditChainEntry)
--    current_hash = sha256(previous_hash || runId || kind || payload ||
--    recordedAt). The per-tenant head is the most-recent current_hash; the
--    repository serializes appends per tenant so the chain stays linear.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "workflow_audit_chain" (
  "id"               text PRIMARY KEY NOT NULL,
  "run_id"           text NOT NULL,
  "tenant_id"        text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "previous_hash"    text NOT NULL,
  "current_hash"     text NOT NULL,
  "recorded_kind"    text NOT NULL,
  "recorded_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recorded_at"      timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workflow_audit_chain_run_idx"          ON "workflow_audit_chain" ("run_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "workflow_audit_chain_tenant_head_idx"  ON "workflow_audit_chain" ("tenant_id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_audit_chain_current_hash_uidx" ON "workflow_audit_chain" ("tenant_id", "current_hash");

-- ---------------------------------------------------------------------------
-- 4. RLS — canonical pattern: ENABLE + FORCE + current_setting GUC.
--    Strict tenant isolation for all three workflow tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  strict_tables text[] := ARRAY[
    'workflow_runs',
    'workflow_run_events',
    'workflow_audit_chain'
  ];
BEGIN
  FOREACH tbl IN ARRAY strict_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      tbl || '_tenant_isolation', tbl
    );
    -- Service-role bypass — lets system jobs (and the engine's globally-unique
    -- findById, which resolves a run by id then verifies run.tenant_id in app
    -- code) read across tenants when app.is_service_role is set. Mirrors the
    -- 0179 service_role_bypass shape used elsewhere in the codebase.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_service_role_bypass', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (current_setting(''app.is_service_role'', true) = ''true'') '
      'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
      tbl || '_service_role_bypass', tbl
    );
    -- REVOKE anon defence-in-depth, guarded for vanilla PG where the Supabase
    -- `anon` role does not exist. Inline-guarded (NOT a block-level EXCEPTION)
    -- so a missing role never rolls back the ENABLE/FORCE/POLICY above.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
