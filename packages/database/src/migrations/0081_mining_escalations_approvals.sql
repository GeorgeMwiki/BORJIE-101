-- =============================================================================
-- Migration 0081 — Manager Dispatch: Escalations + Approvals (Wave B-MgrDispatch)
--
-- Companion to:
--   - services/api-gateway/src/routes/mining/escalations.hono.ts
--   - services/api-gateway/src/routes/mining/approvals.hono.ts
--   - services/api-gateway/src/routes/mining/tasks-suggest.hono.ts
--   - Docs/research/manager-dispatch-sota.md  (§9 wire-level spec)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Two tables:
--
--   mining_escalations        — manager-up + worker-up escalation chain
--                                (incidents, tasks, crew, production, safety).
--                                Each row is a directed message from a
--                                raising user to either a specific user
--                                (to_user_id) OR a role (to_role) for
--                                broadcast. Status moves open ->
--                                acknowledged -> resolved.
--
--   mining_approval_items     — unified Linear-Triage-style approval queue:
--                                leave, advance, reassign, fuel, expense,
--                                other. One row per pending decision the
--                                manager (or owner) must make. Decisions
--                                are approve | reject | defer | expired.
--
-- Both tables are tenant-scoped via the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern. RLS is
-- FORCE-enabled per the Borjie hard rule (`CLAUDE.md`) so the policy
-- applies to table owners too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- mining_escalations — escalation chain (manager <-> worker <-> owner)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_escalations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  /** User who raised the escalation. */
  raised_by_user_id   uuid        NOT NULL,
  /** Specific addressee (null when broadcast to a role). */
  to_user_id          uuid,
  /** Role-wide broadcast (manager|owner|safety_officer|...). Null when to_user_id set. */
  to_role             text,
  /** Originating domain object kind: incident|task|crew|production|safety. */
  source_kind         text        NOT NULL,
  /** Originating domain object id when known. */
  source_id           uuid,
  /** Swahili-first context narrative (bilingual; English may follow). */
  context_sw          text        NOT NULL,
  /** info|warning|critical. Critical fail-closed in policy gate. */
  severity            text        NOT NULL DEFAULT 'warning',
  /** open|acknowledged|resolved. */
  status              text        NOT NULL DEFAULT 'open',
  acknowledged_at     timestamptz,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  /** Hash-chained audit-trail link (audit-trail package writes this on transition). */
  hash_chain_id       uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_escalations_severity_chk'
  ) THEN
    ALTER TABLE mining_escalations
      ADD CONSTRAINT mining_escalations_severity_chk
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_escalations_status_chk'
  ) THEN
    ALTER TABLE mining_escalations
      ADD CONSTRAINT mining_escalations_status_chk
      CHECK (status IN ('open', 'acknowledged', 'resolved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_escalations_source_kind_chk'
  ) THEN
    ALTER TABLE mining_escalations
      ADD CONSTRAINT mining_escalations_source_kind_chk
      CHECK (source_kind IN ('incident', 'task', 'crew', 'production', 'safety'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_escalations_addressee_chk'
  ) THEN
    ALTER TABLE mining_escalations
      ADD CONSTRAINT mining_escalations_addressee_chk
      CHECK (
        (to_user_id IS NOT NULL AND to_role IS NULL)
        OR (to_user_id IS NULL AND to_role IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_escalations_context_nonempty_chk'
  ) THEN
    ALTER TABLE mining_escalations
      ADD CONSTRAINT mining_escalations_context_nonempty_chk
      CHECK (length(context_sw) > 0);
  END IF;
END $$;

-- Hot path: list a manager's open escalations newest first.
CREATE INDEX IF NOT EXISTS idx_mining_escalations_tenant_status_created
  ON mining_escalations (tenant_id, status, created_at DESC);

-- Inbox queries: addressee lookup ("escalations sent to me").
CREATE INDEX IF NOT EXISTS idx_mining_escalations_tenant_to_user
  ON mining_escalations (tenant_id, to_user_id, status);

-- Outbox queries: who-raised-what lookup.
CREATE INDEX IF NOT EXISTS idx_mining_escalations_tenant_raised_by
  ON mining_escalations (tenant_id, raised_by_user_id, status);

-- Role broadcast lookup.
CREATE INDEX IF NOT EXISTS idx_mining_escalations_tenant_to_role
  ON mining_escalations (tenant_id, to_role, status);

ALTER TABLE mining_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_escalations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_escalations'
       AND policyname = 'mining_escalations_tenant_isolation'
  ) THEN
    CREATE POLICY mining_escalations_tenant_isolation
      ON mining_escalations
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- mining_approval_items — unified approval queue (Linear-Triage pattern)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_approval_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  /** Approver (manager / owner / safety officer). */
  approver_user_id      uuid        NOT NULL,
  /** leave|advance|reassign|fuel|expense|other. */
  request_kind          text        NOT NULL,
  /** Free-form structured payload (worker_id, dates, amount, reason, ...). */
  request_payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** User who submitted the request. */
  requested_by_user_id  uuid        NOT NULL,
  /** pending|approved|rejected|deferred|expired. */
  status                text        NOT NULL DEFAULT 'pending',
  decided_at            timestamptz,
  /** Mandatory reason on reject (audit chain); optional on approve / defer. */
  decision_reason       text,
  /** Auto-expiry timestamp (e.g. defer 24h). */
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  /** Hash-chained audit-trail link. */
  hash_chain_id         uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_approval_items_status_chk'
  ) THEN
    ALTER TABLE mining_approval_items
      ADD CONSTRAINT mining_approval_items_status_chk
      CHECK (status IN ('pending', 'approved', 'rejected', 'deferred', 'expired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_approval_items_kind_chk'
  ) THEN
    ALTER TABLE mining_approval_items
      ADD CONSTRAINT mining_approval_items_kind_chk
      CHECK (request_kind IN ('leave', 'advance', 'reassign', 'fuel', 'expense', 'other'));
  END IF;
END $$;

-- Hot path: pending queue for an approver.
CREATE INDEX IF NOT EXISTS idx_mining_approval_items_tenant_status_created
  ON mining_approval_items (tenant_id, status, created_at DESC);

-- Per-approver inbox.
CREATE INDEX IF NOT EXISTS idx_mining_approval_items_tenant_approver
  ON mining_approval_items (tenant_id, approver_user_id, status);

-- Per-requester audit lookup.
CREATE INDEX IF NOT EXISTS idx_mining_approval_items_tenant_requested_by
  ON mining_approval_items (tenant_id, requested_by_user_id, status);

-- Expiry scan (cron job promotes pending -> expired).
CREATE INDEX IF NOT EXISTS idx_mining_approval_items_expires_at
  ON mining_approval_items (expires_at)
  WHERE status = 'pending';

ALTER TABLE mining_approval_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_approval_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_approval_items'
       AND policyname = 'mining_approval_items_tenant_isolation'
  ) THEN
    CREATE POLICY mining_approval_items_tenant_isolation
      ON mining_approval_items
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
