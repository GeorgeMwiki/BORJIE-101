-- =============================================================================
-- Migration 0126 — Field-workforce help requests (R5 closure)
--
-- Backs the workforce-mobile WorkerHeroCard "Need help" action wired in
-- apps/workforce-mobile/src/components/WorkerHomeHero.tsx. When a worker
-- taps "Naomba msaada" the FE POSTs to
-- /api/v1/field/workforce/help-requests; this table persists the request
-- so the manager dashboard + owner cockpit can surface it.
--
-- Lifecycle:
--   open      worker filed a request
--   ack       a manager acknowledged it (intervention in progress)
--   resolved  the issue was addressed
--   cancelled worker cancelled before any acknowledgement
--
-- Tenant scope:
--   RLS FORCE per CLAUDE.md hard rule. The api-gateway database
--   middleware sets `app.current_tenant_id` on every authenticated
--   request — handlers MUST NOT double-filter.
--
-- Audit hash chain pointer (audit_hash_id) is stamped at insert time
-- by the route handler so forensic replay can reconstruct the action
-- timeline. The chain itself lives in `ai_audit_chain` (migration
-- 0080 family).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS help_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  worker_user_id  UUID NOT NULL,
  task_id         UUID,
  site_id         UUID,
  locale          TEXT NOT NULL DEFAULT 'sw',
  message_text    TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  ack_by_user_id  UUID,
  ack_at          TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  audit_hash_id   UUID,
  provenance      JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT help_requests_status_check CHECK (
    status IN ('open', 'ack', 'resolved', 'cancelled')
  ),
  CONSTRAINT help_requests_locale_check CHECK (
    locale IN ('sw', 'en')
  )
);

CREATE INDEX IF NOT EXISTS help_requests_tenant_status_idx
  ON help_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS help_requests_tenant_worker_idx
  ON help_requests (tenant_id, worker_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS help_requests_tenant_task_idx
  ON help_requests (tenant_id, task_id)
  WHERE task_id IS NOT NULL;

-- =============================================================================
-- Row-level security: per-tenant isolation FORCE-enabled.
-- =============================================================================

ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS help_requests_tenant_isolation ON help_requests;

CREATE POLICY help_requests_tenant_isolation ON help_requests
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE help_requests IS
  'R5 worker hero card "Need help" submissions. Surfaced to managers '
  'via /api/v1/field/workforce/help-requests and emitted as a '
  'workforce.shift_event on the cockpit bus.';

COMMIT;
