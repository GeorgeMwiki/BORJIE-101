-- =============================================================================
-- Migration 0134 — Workforce openings + payroll runs
--
-- Cross-role chain closure (issue #193): three chains landed in a single
-- migration because they share the workforce master record.
--
--   1. `workforce_openings`            — owner posts a job opening; manager
--                                        / Mwikila drafts an invitation
--                                        from the opening row.
--   2. `payroll_runs`                  — owner triggers a period payroll
--                                        run; rows transition draft ->
--                                        previewed -> committed.
--   3. `payroll_line_items`            — one row per worker per run.
--                                        Stamps the LedgerService journal
--                                        id post-CAS so the audit view can
--                                        show the full debit/credit chain.
--
-- Adds `opening_id` to `workforce_invitations` so an invitation traces
-- back to the opening it was drafted from.
--
-- Adds `workforce_status` to `users` so the manager-approve gate can
-- flip a candidate to `active` without touching the user master row.
--
-- Forward-only. Append-only per CLAUDE.md "Migrations are immutable".
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
--
-- Tenant scope:
--   RLS FORCE enabled per CLAUDE.md hard rule. The
--   `app.current_tenant_id` GUC is bound by api-gateway
--   databaseMiddleware. Never disable RLS or double-filter from app code.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — workforce_openings
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_openings (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text          NOT NULL,
  created_by_user_id text          NOT NULL,
  title              text          NOT NULL,
  description_md     text          NOT NULL,
  -- employee | manager. Drives downstream invitation assigned_role.
  role_required      text          NOT NULL,
  -- How many activations this opening can absorb before auto-closing.
  count_needed       integer       NOT NULL DEFAULT 1,
  -- Open | filled | closed | expired.
  status             text          NOT NULL DEFAULT 'open',
  -- Optional site assignment cascaded to drafted invitations.
  assigned_site_id   uuid,
  expires_at         timestamptz   NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  closed_at          timestamptz,

  CONSTRAINT workforce_openings_role_chk
    CHECK (role_required IN ('employee', 'manager')),
  CONSTRAINT workforce_openings_status_chk
    CHECK (status IN ('open', 'filled', 'closed', 'expired')),
  CONSTRAINT workforce_openings_count_chk
    CHECK (count_needed > 0)
);

CREATE INDEX IF NOT EXISTS idx_workforce_openings_tenant_status_created
  ON workforce_openings (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workforce_openings_expires_at
  ON workforce_openings (expires_at)
  WHERE status = 'open';

ALTER TABLE workforce_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_openings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_openings'
       AND policyname = 'workforce_openings_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_openings_tenant_isolation
      ON workforce_openings
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE workforce_openings IS
  'HR onboarding chain (issue #193, L-A) — owner posts a job opening; '
  'manager / Mwikila drafts invitations from the row. count_needed '
  'decrements on every approve until the opening auto-flips to filled.';

-- -----------------------------------------------------------------------------
-- §2 — workforce_invitations.opening_id link
-- -----------------------------------------------------------------------------

ALTER TABLE workforce_invitations
  ADD COLUMN IF NOT EXISTS opening_id uuid;

-- A pending invitation can be drafted directly without an opening (legacy
-- path), so the FK is nullable. When set, references workforce_openings.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_invitations_opening_id_fk'
  ) THEN
    ALTER TABLE workforce_invitations
      ADD CONSTRAINT workforce_invitations_opening_id_fk
      FOREIGN KEY (opening_id) REFERENCES workforce_openings(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workforce_invitations_opening
  ON workforce_invitations (opening_id)
  WHERE opening_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- §3 — users.workforce_status (manager approve gate)
-- -----------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workforce_status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_workforce_status_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_workforce_status_chk
      CHECK (workforce_status IN ('pending', 'active', 'rejected', 'suspended'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §4 — payroll_runs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text          NOT NULL,
  created_by_user_id  text          NOT NULL,
  period_start        date          NOT NULL,
  period_end          date          NOT NULL,
  -- draft -> previewed -> committed -> paid -> failed
  -- 'paid'   = all line items settled (after M-Pesa callbacks)
  -- 'failed' = at least one line item terminal-failed during payout
  status              text          NOT NULL DEFAULT 'draft',
  -- Sum of all line_items.net_tzs. Stamped at preview-time.
  total_tzs           numeric(15,2) NOT NULL DEFAULT 0,
  worker_count        integer       NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  previewed_at        timestamptz,
  committed_at        timestamptz,

  CONSTRAINT payroll_runs_status_chk CHECK (
    status IN ('draft', 'previewed', 'committed', 'paid', 'failed')
  ),
  CONSTRAINT payroll_runs_period_chk CHECK (period_end >= period_start),
  CONSTRAINT payroll_runs_total_nonneg_chk CHECK (total_tzs >= 0),
  CONSTRAINT payroll_runs_workers_nonneg_chk CHECK (worker_count >= 0),
  -- Idempotency: one run per tenant per (period_start, period_end).
  -- Re-trigger from the owner returns the existing row.
  CONSTRAINT payroll_runs_unique_tenant_period UNIQUE (
    tenant_id, period_start, period_end
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_status_created
  ON payroll_runs (tenant_id, status, created_at DESC);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'payroll_runs'
       AND policyname = 'payroll_runs_tenant_isolation'
  ) THEN
    CREATE POLICY payroll_runs_tenant_isolation
      ON payroll_runs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE payroll_runs IS
  'Payroll chain (issue #193, L-B) — one row per (tenant, period). '
  'State machine: draft -> previewed -> committed -> paid|failed. '
  'Money path goes through LedgerService.post() at commit-time '
  '(CLAUDE.md hard rule).';

-- -----------------------------------------------------------------------------
-- §5 — payroll_line_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_line_items (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text          NOT NULL,
  payroll_run_id      uuid          NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_user_id      text          NOT NULL,
  -- Snapshot of hours-worked across period (sum of shift-report rows).
  hours_worked        numeric(8,2)  NOT NULL DEFAULT 0,
  overtime_hours      numeric(8,2)  NOT NULL DEFAULT 0,
  hourly_rate_tzs     numeric(12,2) NOT NULL DEFAULT 0,
  base_tzs            numeric(15,2) NOT NULL DEFAULT 0,
  overtime_tzs        numeric(15,2) NOT NULL DEFAULT 0,
  bonus_tzs           numeric(15,2) NOT NULL DEFAULT 0,
  deduction_tzs       numeric(15,2) NOT NULL DEFAULT 0,
  net_tzs             numeric(15,2) NOT NULL DEFAULT 0,
  -- pending -> posted -> paid -> failed
  status              text          NOT NULL DEFAULT 'pending',
  -- LedgerService journal id. NULL until commit lands.
  ledger_txn_id       text,
  -- M-Pesa B2C provider ref. NULL until payout fires.
  payout_provider     text,
  payout_provider_ref text,
  failure_reason      text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  posted_at           timestamptz,
  paid_at             timestamptz,

  CONSTRAINT payroll_line_items_status_chk CHECK (
    status IN ('pending', 'posted', 'paid', 'failed')
  ),
  CONSTRAINT payroll_line_items_hours_nonneg_chk CHECK (hours_worked >= 0),
  CONSTRAINT payroll_line_items_overtime_nonneg_chk CHECK (overtime_hours >= 0),
  CONSTRAINT payroll_line_items_rate_nonneg_chk CHECK (hourly_rate_tzs >= 0),
  CONSTRAINT payroll_line_items_base_nonneg_chk CHECK (base_tzs >= 0),
  CONSTRAINT payroll_line_items_overtime_tzs_nonneg_chk CHECK (overtime_tzs >= 0),
  CONSTRAINT payroll_line_items_bonus_nonneg_chk CHECK (bonus_tzs >= 0),
  CONSTRAINT payroll_line_items_deduction_nonneg_chk CHECK (deduction_tzs >= 0),
  CONSTRAINT payroll_line_items_net_nonneg_chk CHECK (net_tzs >= 0),
  -- net = base + overtime + bonus - deduction (sanity-check the math).
  CONSTRAINT payroll_line_items_math_chk CHECK (
    net_tzs = base_tzs + overtime_tzs + bonus_tzs - deduction_tzs
  ),
  -- One line item per (run, worker).
  CONSTRAINT payroll_line_items_unique_run_worker UNIQUE (
    payroll_run_id, worker_user_id
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_line_items_tenant_run
  ON payroll_line_items (tenant_id, payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_payroll_line_items_worker_status
  ON payroll_line_items (tenant_id, worker_user_id, status);

ALTER TABLE payroll_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_line_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'payroll_line_items'
       AND policyname = 'payroll_line_items_tenant_isolation'
  ) THEN
    CREATE POLICY payroll_line_items_tenant_isolation
      ON payroll_line_items
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE payroll_line_items IS
  'Payroll chain (issue #193, L-B) — one row per (run, worker). '
  'Stamps ledger_txn_id post-CAS from LedgerService.post() so the audit '
  'view can show the full debit (payroll-expense) / credit (cash) chain.';

COMMIT;
