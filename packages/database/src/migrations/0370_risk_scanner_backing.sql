-- =============================================================================
-- Migration 0370 — Risk-scanner backing relations (Tier-1 powers reality).
--
-- The 33-rule risk scanner (`services/api-gateway/src/services/risk-scanner/`)
-- reads a state snapshot from a set of backing relations. Several of those
-- relations never shipped, so the scanner fail-softs every one of their state
-- fields to null and the matching rules can never fire on real data. This is
-- the exact "empty-table false-green" the Tier-1 reality pass is killing.
--
-- This migration creates the genuinely-absent owner-provided relations with
-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy bound to
-- `app.current_tenant_id` (the pattern every tenant-scoped table in this repo
-- uses — cf. 0106_insurance_policies.sql). Companion seed
-- (`seeds/risk-scanner-backing.seed.ts`) fills the LIVE demo/test tenants with
-- REAL representative mining values so the scanner returns real results.
--
-- COMPUTE-FROM-EXISTING: `production_mom_summary` is a SECURITY INVOKER VIEW
-- computed from the shipped `production_tonnage_events` base table (real MoM
-- tonnage deltas), NOT a seeded phantom. It inherits the base table's RLS.
--
-- NOT created here (owned by the BENCH track, read fail-soft only):
--   lbma_fix_summary, fx_rates_intraday
--
-- All base tables in this repo key `tenant_id` as TEXT; these relations match
-- so the tenant GUC comparison (`tenant_id = current_setting(...)`) is a
-- direct text equality with no cast hazard.
--
-- Idempotent. Forward-only. Never edits a shipped migration.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helper: apply FORCE RLS + tenant-isolation policy to a table.
-- Inlined per-table below (no PL/pgSQL function) to keep the migration a flat
-- forward-only delta.
-- ---------------------------------------------------------------------------

-- =========================================================================
-- 1. accounts_receivable  (cash.ar_aging_critical)
--    Owner-provided AR ledger with per-invoice aging. Scanner reads
--    SUM(amount_tzs) and SUM(amount_tzs WHERE aging_days > 60).
-- =========================================================================
CREATE TABLE IF NOT EXISTS accounts_receivable (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text           NOT NULL,
  buyer_id       text,
  buyer_name     text,
  invoice_no     text,
  amount_tzs     numeric(18, 2) NOT NULL,
  aging_days     integer        NOT NULL DEFAULT 0,
  due_at         timestamptz,
  status         text           NOT NULL DEFAULT 'open',
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT accounts_receivable_amount_chk CHECK (amount_tzs >= 0),
  CONSTRAINT accounts_receivable_aging_chk  CHECK (aging_days >= 0)
);
CREATE INDEX IF NOT EXISTS accounts_receivable_tenant_idx
  ON accounts_receivable (tenant_id, aging_days);
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='accounts_receivable' AND policyname='accounts_receivable_tenant_isolation') THEN
    CREATE POLICY accounts_receivable_tenant_isolation ON accounts_receivable
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 2. payroll_schedule  (hr.payroll_readiness_gap, cash.payroll_short_warning)
-- =========================================================================
CREATE TABLE IF NOT EXISTS payroll_schedule (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text           NOT NULL,
  next_run_at       timestamptz    NOT NULL,
  total_amount_tzs  numeric(18, 2) NOT NULL,
  headcount         integer        NOT NULL DEFAULT 0,
  cadence           text           NOT NULL DEFAULT 'monthly',
  status            text           NOT NULL DEFAULT 'scheduled',
  created_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT payroll_schedule_amount_chk CHECK (total_amount_tzs >= 0)
);
CREATE INDEX IF NOT EXISTS payroll_schedule_tenant_next_idx
  ON payroll_schedule (tenant_id, next_run_at);
ALTER TABLE payroll_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_schedule FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='payroll_schedule' AND policyname='payroll_schedule_tenant_isolation') THEN
    CREATE POLICY payroll_schedule_tenant_isolation ON payroll_schedule
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 3. fuel_inventory  (operational.fuel_inventory_below_safety)
--    Standing on-site fuel stock + daily burn. Distinct from the shipped
--    `fuel_logs` (per-issuance events); this is the current inventory snapshot
--    the safety-floor rule reads (SUM(litres_remaining)/MAX(daily_burn_litres)).
-- =========================================================================
CREATE TABLE IF NOT EXISTS fuel_inventory (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text           NOT NULL,
  site_id             text,
  fuel_kind           text           NOT NULL DEFAULT 'diesel',
  litres_remaining    numeric(12, 2) NOT NULL,
  daily_burn_litres   numeric(12, 2) NOT NULL,
  recorded_at         timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT fuel_inventory_litres_chk CHECK (litres_remaining >= 0),
  CONSTRAINT fuel_inventory_burn_chk   CHECK (daily_burn_litres >= 0)
);
CREATE INDEX IF NOT EXISTS fuel_inventory_tenant_idx
  ON fuel_inventory (tenant_id);
ALTER TABLE fuel_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_inventory FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='fuel_inventory' AND policyname='fuel_inventory_tenant_isolation') THEN
    CREATE POLICY fuel_inventory_tenant_isolation ON fuel_inventory
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 4. equipment_failures  (operational.equipment_failure_pattern)
-- =========================================================================
CREATE TABLE IF NOT EXISTS equipment_failures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  site_id         text,
  equipment_kind  text        NOT NULL,
  asset_id        text,
  failure_mode    text,
  failed_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_failures_tenant_idx
  ON equipment_failures (tenant_id, failed_at);
ALTER TABLE equipment_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_failures FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='equipment_failures' AND policyname='equipment_failures_tenant_isolation') THEN
    CREATE POLICY equipment_failures_tenant_isolation ON equipment_failures
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 5. workforce_separations  (hr.supervisor_attrition_spike)
-- =========================================================================
CREATE TABLE IF NOT EXISTS workforce_separations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text        NOT NULL,
  employee_id    text,
  full_name      text,
  role           text        NOT NULL,
  separation_kind text       NOT NULL DEFAULT 'resignation',
  separated_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_separations_tenant_idx
  ON workforce_separations (tenant_id, separated_at);
ALTER TABLE workforce_separations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_separations FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='workforce_separations' AND policyname='workforce_separations_tenant_isolation') THEN
    CREATE POLICY workforce_separations_tenant_isolation ON workforce_separations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 6. royalty_drafts_with_trend  (compliance.audit_trigger_signal)
--    Owner-provided royalty draft with the trailing 6-month average captured
--    at draft time. Scanner reads current_draft_tzs vs trailing_avg_tzs.
-- =========================================================================
CREATE TABLE IF NOT EXISTS royalty_drafts_with_trend (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text           NOT NULL,
  draft_date         date           NOT NULL,
  current_draft_tzs  numeric(18, 2) NOT NULL,
  trailing_avg_tzs   numeric(18, 2) NOT NULL,
  mineral            text,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT royalty_drafts_with_trend_amount_chk CHECK (current_draft_tzs >= 0)
);
CREATE INDEX IF NOT EXISTS royalty_drafts_with_trend_tenant_idx
  ON royalty_drafts_with_trend (tenant_id, draft_date DESC);
ALTER TABLE royalty_drafts_with_trend ENABLE ROW LEVEL SECURITY;
ALTER TABLE royalty_drafts_with_trend FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='royalty_drafts_with_trend' AND policyname='royalty_drafts_with_trend_tenant_isolation') THEN
    CREATE POLICY royalty_drafts_with_trend_tenant_isolation ON royalty_drafts_with_trend
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 7. regulator_status  (compliance.regulator_stop_work_risk,
--    compliance.licence_inventory_thin)
--    Current per-regulator health tone (green/amber/red).
-- =========================================================================
CREATE TABLE IF NOT EXISTS regulator_status (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  regulator     text        NOT NULL,
  status_tone   text        NOT NULL DEFAULT 'green',
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulator_status_tone_chk CHECK (status_tone IN ('green','amber','red')),
  CONSTRAINT regulator_status_tenant_reg_uq UNIQUE (tenant_id, regulator)
);
ALTER TABLE regulator_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulator_status FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='regulator_status' AND policyname='regulator_status_tenant_isolation') THEN
    CREATE POLICY regulator_status_tenant_isolation ON regulator_status
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 8. buyer_credit_signals  (counterparty.buyer_default_signal,
--    market.revenue_concentration_risk)
-- =========================================================================
CREATE TABLE IF NOT EXISTS buyer_credit_signals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  buyer_id            text        NOT NULL,
  buyer_name          text        NOT NULL,
  late_payment_count  integer     NOT NULL DEFAULT 0,
  crb_score_delta     integer,
  last_signal_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_credit_signals_late_chk CHECK (late_payment_count >= 0)
);
CREATE INDEX IF NOT EXISTS buyer_credit_signals_tenant_idx
  ON buyer_credit_signals (tenant_id);
ALTER TABLE buyer_credit_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_credit_signals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='buyer_credit_signals' AND policyname='buyer_credit_signals_tenant_isolation') THEN
    CREATE POLICY buyer_credit_signals_tenant_isolation ON buyer_credit_signals
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 9. supplier_quality_signals  (counterparty.supplier_quality_drop)
-- =========================================================================
CREATE TABLE IF NOT EXISTS supplier_quality_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  supplier_id     text        NOT NULL,
  supplier_name   text        NOT NULL,
  off_spec_count  integer     NOT NULL DEFAULT 0,
  window_days     integer     NOT NULL DEFAULT 60,
  last_signal_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_quality_signals_off_chk CHECK (off_spec_count >= 0)
);
CREATE INDEX IF NOT EXISTS supplier_quality_signals_tenant_idx
  ON supplier_quality_signals (tenant_id, window_days);
ALTER TABLE supplier_quality_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quality_signals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='supplier_quality_signals' AND policyname='supplier_quality_signals_tenant_isolation') THEN
    CREATE POLICY supplier_quality_signals_tenant_isolation ON supplier_quality_signals
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 10. security_audit_events  (security.access_anomaly,
--     security.kill_switch_potential)
-- =========================================================================
CREATE TABLE IF NOT EXISTS security_audit_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  event_kind    text        NOT NULL,
  actor_id      text,
  ip_address    text,
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_audit_events_tenant_idx
  ON security_audit_events (tenant_id, occurred_at DESC);
ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='security_audit_events' AND policyname='security_audit_events_tenant_isolation') THEN
    CREATE POLICY security_audit_events_tenant_isolation ON security_audit_events
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 11. cda_milestones  (reputational.csr_commitment_slipping)
--     Community Development Agreement milestones.
-- =========================================================================
CREATE TABLE IF NOT EXISTS cda_milestones (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  title         text        NOT NULL,
  commitment    text,
  due_at        timestamptz,
  status        text        NOT NULL DEFAULT 'on_track',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cda_milestones_status_chk
    CHECK (status IN ('on_track','at_risk','overdue','done'))
);
CREATE INDEX IF NOT EXISTS cda_milestones_tenant_idx
  ON cda_milestones (tenant_id, status);
ALTER TABLE cda_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE cda_milestones FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='cda_milestones' AND policyname='cda_milestones_tenant_isolation') THEN
    CREATE POLICY cda_milestones_tenant_isolation ON cda_milestones
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 12. withholding_tax_summary  (tax.withholding_exposure_critical)
-- =========================================================================
CREATE TABLE IF NOT EXISTS withholding_tax_summary (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text           NOT NULL,
  period_label   text           NOT NULL,
  payable_tzs    numeric(18, 2) NOT NULL DEFAULT 0,
  provision_tzs  numeric(18, 2) NOT NULL DEFAULT 0,
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT withholding_tax_summary_payable_chk CHECK (payable_tzs >= 0),
  CONSTRAINT withholding_tax_summary_prov_chk    CHECK (provision_tzs >= 0),
  CONSTRAINT withholding_tax_summary_tenant_period_uq UNIQUE (tenant_id, period_label)
);
ALTER TABLE withholding_tax_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholding_tax_summary FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='withholding_tax_summary' AND policyname='withholding_tax_summary_tenant_isolation') THEN
    CREATE POLICY withholding_tax_summary_tenant_isolation ON withholding_tax_summary
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 13. tra_correspondence  (tax.tra_inquiry_signal)
-- =========================================================================
CREATE TABLE IF NOT EXISTS tra_correspondence (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text        NOT NULL,
  subject        text,
  inquiry_open   boolean     NOT NULL DEFAULT false,
  last_filed_at  timestamptz,
  received_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tra_correspondence_tenant_idx
  ON tra_correspondence (tenant_id);
ALTER TABLE tra_correspondence ENABLE ROW LEVEL SECURITY;
ALTER TABLE tra_correspondence FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='tra_correspondence' AND policyname='tra_correspondence_tenant_isolation') THEN
    CREATE POLICY tra_correspondence_tenant_isolation ON tra_correspondence
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 14. contracts  (legal.contract_expiring_critical)
-- =========================================================================
CREATE TABLE IF NOT EXISTS contracts (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text           NOT NULL,
  counterparty_name  text           NOT NULL,
  contract_kind      text           NOT NULL DEFAULT 'offtake',
  annual_value_tzs   numeric(18, 2),
  effective_at       timestamptz,
  expires_at         timestamptz    NOT NULL,
  status             text           NOT NULL DEFAULT 'active',
  created_at         timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_tenant_expiry_idx
  ON contracts (tenant_id, expires_at);
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='contracts' AND policyname='contracts_tenant_isolation') THEN
    CREATE POLICY contracts_tenant_isolation ON contracts
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 15. contract_renewal_workflows  (legal.contract_expiring_critical join)
-- =========================================================================
CREATE TABLE IF NOT EXISTS contract_renewal_workflows (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  contract_id  uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'drafting',
  opened_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_renewal_workflows_status_chk
    CHECK (status IN ('drafting','negotiation','signed','abandoned'))
);
CREATE INDEX IF NOT EXISTS contract_renewal_workflows_tenant_idx
  ON contract_renewal_workflows (tenant_id, contract_id);
ALTER TABLE contract_renewal_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_renewal_workflows FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='contract_renewal_workflows' AND policyname='contract_renewal_workflows_tenant_isolation') THEN
    CREATE POLICY contract_renewal_workflows_tenant_isolation ON contract_renewal_workflows
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 16. disputes  (legal.dispute_escalation_pattern)
-- =========================================================================
CREATE TABLE IF NOT EXISTS disputes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  counterparty_id     text        NOT NULL,
  counterparty_name   text        NOT NULL,
  subject             text,
  status              text        NOT NULL DEFAULT 'open',
  opened_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_tenant_idx
  ON disputes (tenant_id, opened_at);
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='disputes' AND policyname='disputes_tenant_isolation') THEN
    CREATE POLICY disputes_tenant_isolation ON disputes
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- 17. production_mom_summary  — COMPUTE-FROM-EXISTING VIEW.
--     Month-over-month ore-tonnage delta computed from the shipped
--     `production_tonnage_events` base table (real data, no seed). Emits one
--     row per recent month with `month_offset` (0 = current month, 1 = last,
--     …) and `mom_delta_pct` (% change in monthly ore tonnage vs the prior
--     month). SECURITY INVOKER so the view inherits the base table's RLS —
--     each tenant sees only its own tonnage.
-- =========================================================================
CREATE OR REPLACE VIEW production_mom_summary
  WITH (security_invoker = true) AS
WITH monthly AS (
  SELECT
    tenant_id,
    date_trunc('month', captured_at) AS month_start,
    SUM(ore_tonnes)                  AS ore_tonnes
  FROM production_tonnage_events
  WHERE captured_at > now() - INTERVAL '13 months'
  GROUP BY tenant_id, date_trunc('month', captured_at)
),
ranked AS (
  SELECT
    tenant_id,
    month_start,
    ore_tonnes,
    LAG(ore_tonnes) OVER (
      PARTITION BY tenant_id ORDER BY month_start
    ) AS prev_ore_tonnes,
    (
      EXTRACT(YEAR  FROM age(date_trunc('month', now()), month_start)) * 12
      + EXTRACT(MONTH FROM age(date_trunc('month', now()), month_start))
    )::int AS month_offset
  FROM monthly
)
SELECT
  tenant_id,
  month_offset,
  CASE
    WHEN prev_ore_tonnes IS NULL OR prev_ore_tonnes = 0 THEN NULL
    ELSE ((ore_tonnes - prev_ore_tonnes) / prev_ore_tonnes * 100)
  END::numeric AS mom_delta_pct
FROM ranked
WHERE month_offset BETWEEN 0 AND 5;

-- =========================================================================
-- 18. SERVICE-ROLE BYPASS — symmetry with 0369 / 0372.
--
-- Each table above carries FORCE ROW LEVEL SECURITY + a tenant-isolation
-- policy, but NO service-role bypass. That asymmetry is a DARK-WORKER gap:
-- an out-of-band writer / refresh cron (companion seed
-- `seeds/risk-scanner-backing.seed.ts`, and any future ingest job) runs under
-- `withServiceRoleContext` (tenant='__system__' + app.is_service_role='true'),
-- which matches NO tenant-isolation policy — so under FORCE RLS its
-- INSERT/UPDATE/DELETE silently touch zero rows (the exact RLS-darkness class
-- migrations 0342/0354/0357 close for the spine tables). The risk-scanner
-- request path is UNAFFECTED (each table's own tenant-isolation policy + FORCE
-- survive); this only re-opens the OUT-OF-BAND write path to the service role.
--
-- `production_mom_summary` is a SECURITY INVOKER VIEW that inherits its base
-- table's RLS — it gets NO policy (a view cannot carry one).
--
-- Idempotent: pg_policies-guarded CREATE POLICY + pg_roles-guarded anon REVOKE.
-- =========================================================================
DO $$
DECLARE
  tbl text;
  backing_tables text[] := ARRAY[
    'accounts_receivable',
    'payroll_schedule',
    'fuel_inventory',
    'equipment_failures',
    'workforce_separations',
    'royalty_drafts_with_trend',
    'regulator_status',
    'buyer_credit_signals',
    'supplier_quality_signals',
    'security_audit_events',
    'cda_milestones',
    'withholding_tax_summary',
    'tra_correspondence',
    'contracts',
    'contract_renewal_workflows',
    'disputes'
  ];
BEGIN
  FOREACH tbl IN ARRAY backing_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
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

COMMIT;
