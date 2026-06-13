-- =============================================================================
-- Migration 0351 — business_flows + flow_runs: the BUSINESS-PROCESS COMPILER
-- substrate (slice 1).
--
-- An owner describes a business process ("how a buyer inquires on a listing");
-- Borjie compiles it into a FlowSpec persisted in `business_flows` (the template:
-- actors/steps/handoffs/SLAs as jsonb) and materializes complementary tabs on
-- every actor's surface (via owner_tabs_structural config bags). Each live
-- execution is a row in `flow_runs` — the durable cross-surface state machine
-- (raised → task_assigned → awaiting_owner_approval|auto → delivered).
--
-- THE GOLDEN FLOW (slice 1): buyer inquiry → worker task → owner visibility →
-- human-gated response → back to buyer.
--
-- TENANT SCOPE (CLAUDE.md hard rule). Both tables belong to the SELLER/owner
-- tenant whose process this is (FORCE RLS on the canonical app.current_tenant_id
-- GUC). `flow_runs.originating_party_id` is the BUYER's tenant_identity id — the
-- inquiry originates cross-tenant — used by the buyer-facing read endpoint which
-- (exactly like buyer/tab-projection.hono.ts) runs under withServiceRoleContext
-- bounded to the buyer's ACTIVE buyer_connection memberships. So flow_runs also
-- carries a SERVICE-ROLE bypass policy for that membership-bounded cross-tenant
-- read; it is NOT a tenant-isolation hole (the route enforces the ReBAC bound).
--
-- FRESH-DB SAFETY / IDEMPOTENCY: CREATE ... IF NOT EXISTS; literal RLS
-- statements (not format/%I) so the rls-coverage analyzer recognises FORCE +
-- policy; DROP-then-CREATE policies; guarded anon REVOKE. Every NOT NULL is on a
-- freshly-created column (no backfill hazard).
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/business-flows.schema.ts
--   * services/api-gateway/src/composition/surface-completion/flow-binder.ts
--   * services/api-gateway/src/routes/mining/flows/inquiry-flow.hono.ts
--   * packages/database/src/migrations/down/0351_down_business_flows.sql
-- =============================================================================

BEGIN;

-- ── business_flows: the compiled FlowSpec (template) ─────────────────────────
CREATE TABLE IF NOT EXISTS business_flows (
  id          text        PRIMARY KEY,
  tenant_id   text        NOT NULL,
  -- Stable key for the flow (e.g. 'buyer_inquiry'); unique per tenant.
  flow_key    text        NOT NULL,
  name        text        NOT NULL,
  -- The process graph: { actors, steps, handoffs, slas } extracted from the
  -- owner's doc (slice 1 seeds the golden inquiry flow).
  spec        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status      text        NOT NULL DEFAULT 'active',
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_flows_tenant_key
  ON business_flows (tenant_id, flow_key);

-- ── flow_runs: a running instance — the durable cross-surface state machine ──
CREATE TABLE IF NOT EXISTS flow_runs (
  id                   text        PRIMARY KEY,
  tenant_id            text        NOT NULL,
  flow_key             text        NOT NULL,
  -- The BUYER's tenant_identity id (cross-tenant originator); used by the
  -- membership-bounded buyer read endpoint. Nullable for owner-initiated flows.
  originating_party_id text,
  -- The buyer's home tenant (context only).
  originating_tenant_id text,
  -- What the run is about (e.g. the marketplace_listings id).
  subject_ref          text,
  -- raised | task_assigned | awaiting_owner_approval | delivered | closed.
  state                text        NOT NULL DEFAULT 'raised',
  -- open | closed.
  status               text        NOT NULL DEFAULT 'open',
  -- The spawned mining_tasks.id (the worker forward-edge).
  task_id              text,
  -- The inquiry payload (subject, message, buyer display).
  payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- The worker's response (the back-edge content the buyer reads).
  response             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz
);

CREATE INDEX IF NOT EXISTS flow_runs_tenant_state_idx
  ON flow_runs (tenant_id, state);
CREATE INDEX IF NOT EXISTS flow_runs_party_idx
  ON flow_runs (originating_party_id);

-- ── RLS — business_flows: tenant isolation only ─────────────────────────────
ALTER TABLE business_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_flows FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_flows_tenant_isolation ON business_flows;
CREATE POLICY business_flows_tenant_isolation
  ON business_flows
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- ── RLS — flow_runs: tenant isolation + service-role bypass (buyer ReBAC read) ─
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_runs_tenant_isolation ON flow_runs;
CREATE POLICY flow_runs_tenant_isolation
  ON flow_runs
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS flow_runs_service_role_bypass ON flow_runs;
CREATE POLICY flow_runs_service_role_bypass
  ON flow_runs
  FOR ALL
  USING (current_setting('app.is_service_role', true) = 'true')
  WITH CHECK (current_setting('app.is_service_role', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.business_flows FROM anon;';
    EXECUTE 'REVOKE ALL ON public.flow_runs FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE business_flows IS
  'Compiled business-process FlowSpec (template): actors/steps/handoffs/SLAs '
  'as jsonb. Tenant-scoped, FORCE RLS. The binder materializes complementary '
  'surface tabs from this spec.';
COMMENT ON TABLE flow_runs IS
  'A running instance of a business flow — the durable cross-surface state '
  'machine (raised→task_assigned→awaiting_owner_approval→delivered). '
  'originating_party_id is the cross-tenant buyer identity; the buyer read '
  'endpoint uses the service-role bypass under its own buyer_connection ReBAC.';

COMMIT;
