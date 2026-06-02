-- =============================================================================
-- Migration 0174 — leave_requests: worker leave (time-off) request + manager
-- approval workflow (WS-3 workforce wires).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The workforce surface had no leave-request capability — no route, no schema,
-- no screen. This migration adds the persistence layer for a single-approval
-- (NO four-eye) leave flow that mirrors the existing community/worker grievance
-- table (safety-csr.schema.ts → grievances):
--   * a worker submits a leave request (status='pending');
--   * a manager (PROPERTY_MANAGER / site_manager) approves or rejects it
--     (status='approved'|'rejected'), stamping the decider + decision time;
--   * every approve/reject hash-chains an entry into ai_audit_chain (append-only)
--     at the route layer — there are NO money columns here, so nothing in this
--     table ever touches the LedgerService money path.
--
-- Companion Drizzle schema: packages/database/src/schemas/leave-requests.schema.ts
-- Source of truth for column names/types/nullability is the route code in
-- services/api-gateway/src/routes/mining/leave-requests.hono.ts.
--
-- HARD RULES HONOURED (CLAUDE.md)
-- ------------------------------
--   * Tenant-scoped table → FORCE ROW LEVEL SECURITY + a tenant-isolation
--     policy on current_setting('app.current_tenant_id', true) (the CANONICAL
--     GUC bound by databaseMiddleware — never the legacy app.tenant_id). The
--     api-gateway additionally predicates on worker_user_id (worker reads/writes
--     only their own rows) / manager role (approve) at the route layer.
--   * REVOKE anon (guarded for vanilla PG / CI empty-PG where the Supabase
--     `anon` role does not exist).
--   * NO money columns — there is nothing money-shaped for any code path to
--     write by mistake.
--   * Forward-only + re-runnable: CREATE TABLE / INDEX IF NOT EXISTS +
--     pg_policies existence guard + pg_roles anon guard. Append-only per the
--     "Migrations are immutable" rule — this file is only ever CREATEd, never
--     edited once shipped.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — leave_requests
--
-- status: pending -> approved | rejected (terminal). `category` is a small
-- closed enum (annual | sick | unpaid | bereavement | maternity | paternity |
-- other) carried as TEXT + CHECK (no pg_enum so the migration stays forward-only
-- + re-runnable on a vanilla / empty PG). start_on / end_on are calendar DATEs;
-- a CHECK guarantees end_on >= start_on so a malformed range is rejected at the
-- DB boundary as well as the zod layer. decided_by_user_id / decided_at /
-- decision_note are non-null only after a manager decision; the route stamps
-- them atomically with the status transition.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  -- The worker who submitted the request (= auth.userId at submit time,
  -- same identity the payroll line items + clock-in events key on).
  worker_user_id      TEXT NOT NULL,
  site_id             TEXT,
  category            TEXT NOT NULL DEFAULT 'annual'
                        CHECK (category IN (
                          'annual','sick','unpaid','bereavement',
                          'maternity','paternity','other'
                        )),
  start_on            DATE NOT NULL,
  end_on              DATE NOT NULL,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
  -- Manager decision metadata — stamped on approve / reject.
  decided_by_user_id  TEXT,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_requests_range_ok CHECK (end_on >= start_on)
);

-- Worker's own list, newest first (GET /leave-requests/mine hot path).
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_worker
  ON leave_requests (tenant_id, worker_user_id, submitted_at DESC);

-- Manager triage queue: tenant + status (+ site filter optional).
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_status
  ON leave_requests (tenant_id, status, submitted_at DESC);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0166 §3: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the worker INSERT, the worker /
-- manager SELECT, and the manager approve/reject UPDATE. Idempotent:
-- ENABLE/FORCE are no-ops if already set; the policy is guarded by a
-- pg_policies existence check; the anon REVOKE is guarded by a pg_roles
-- existence check (anon is a Supabase construct — guard so the migration still
-- applies on a vanilla Postgres / CI empty-PG).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leave_requests'
  ) THEN
    EXECUTE 'ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.leave_requests FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'leave_requests'
        AND policyname = 'leave_requests_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY leave_requests_tenant_isolation ON public.leave_requests
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.leave_requests FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE leave_requests IS
  'WS-3 workforce leave: worker-submitted time-off requests with a single '
  'manager approval (NO four-eye) — pending -> approved | rejected. Mirrors the '
  'grievance flow. Tenant-scoped; RLS FORCE on app.current_tenant_id. Every '
  'approve/reject hash-chains into ai_audit_chain at the route layer. NO money '
  'columns.';

COMMIT;
