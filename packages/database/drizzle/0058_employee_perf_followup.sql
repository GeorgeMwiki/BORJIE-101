-- =============================================================================
-- Migration 0058 — Employee Daily Performance Follow-up (Wave PERF-1)
--
-- Spec: Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md
--
-- Three tenant-scoped tables backing @borjie/employee-perf-followup. All
-- three use the canonical `current_setting('app.tenant_id', true)` GUC RLS
-- policy from migration 0003. The kpi_templates table also accepts a
-- platform-seed sentinel tenant_id '__seed__' that is read-visible to
-- every tenant (no INSERT/UPDATE from tenant scope).
--
--   1. kpi_templates       — per-(tenant, role) catalogue of KPI
--                            definitions. Default KPIs ship as
--                            tenant_id='__seed__' seed rows; tenants may
--                            override by inserting a row with their own
--                            tenant_id and the same role.
--
--   2. employee_scorecards — one row per (tenant, employee, date) with
--                            per-KPI raw measurements, computed bands,
--                            overall_score and a signals jsonb. Hash-
--                            chained via (prev_hash, audit_hash) for
--                            forensic replay.
--
--   3. perf_nudges         — one row per dispatched nudge. recipient_tier
--                            is one of subject | supervisor | owner so
--                            the FOUNDER_LOCKED §3 tiered rendering is
--                            queryable post-hoc.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. kpi_templates — per-(tenant, role) KPI definitions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kpi_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Seed templates use '__seed__'; tenants override by inserting their
      own tenant_id with the same role. */
  tenant_id         text NOT NULL,
  /** Role this template applies to (foreman | geologist | driver |
      accountant | owner | <tenant-custom>). */
  role              text NOT NULL,
  /** Array of KPI definitions:
      [{id, label, target, weight, measure_fn_name, direction}].
      Weights MUST sum to 1.0; the scorer validates at load time. */
  kpi_definitions   jsonb NOT NULL,
  audit_hash        text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_templates_role_nonempty CHECK (length(role) > 0),
  CONSTRAINT kpi_templates_definitions_array CHECK (
    jsonb_typeof(kpi_definitions) = 'array'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kpi_templates_tenant_role
  ON kpi_templates (tenant_id, role);

CREATE INDEX IF NOT EXISTS idx_kpi_templates_role
  ON kpi_templates (role);

ALTER TABLE kpi_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kpi_templates'
       AND policyname = 'kpi_templates_tenant_or_seed_read'
  ) THEN
    CREATE POLICY kpi_templates_tenant_or_seed_read ON kpi_templates
      FOR SELECT
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        OR tenant_id = '__seed__'
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'kpi_templates'
       AND policyname = 'kpi_templates_tenant_isolation_write'
  ) THEN
    CREATE POLICY kpi_templates_tenant_isolation_write ON kpi_templates
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. employee_scorecards — per-(tenant, employee, date) scorecard
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_scorecards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  employee_user_id    text NOT NULL,
  /** Local-date the scorecard covers (yesterday for the 06:00 fire). */
  date                date NOT NULL,
  /** Per-KPI raw measurements + bands:
      [{kpi_id, raw, band, contribution}]. */
  kpis                jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Sum of per-KPI contributions, clamped to [0, 1]. */
  overall_score       real NOT NULL DEFAULT 0,
  /** Free-form anomaly + insight signals jsonb. */
  signals             jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Hash of the previous scorecard in the per-(tenant, employee) chain.
      Empty string for genesis. */
  prev_hash           text NOT NULL DEFAULT '',
  audit_hash          text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_scorecards_score_range CHECK (
    overall_score >= 0 AND overall_score <= 1
  ),
  CONSTRAINT employee_scorecards_kpis_array CHECK (
    jsonb_typeof(kpis) = 'array'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_scorecards_employee_date
  ON employee_scorecards (tenant_id, employee_user_id, date);

CREATE INDEX IF NOT EXISTS idx_employee_scorecards_recent
  ON employee_scorecards (tenant_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_employee_scorecards_employee_recent
  ON employee_scorecards (tenant_id, employee_user_id, date DESC);

ALTER TABLE employee_scorecards ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'employee_scorecards'
       AND policyname = 'employee_scorecards_tenant_isolation'
  ) THEN
    CREATE POLICY employee_scorecards_tenant_isolation ON employee_scorecards
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. perf_nudges — one row per dispatched nudge (subject + supervisor + owner)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS perf_nudges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  /** FK to employee_scorecards.id — the scorecard that produced this
      nudge. */
  scorecard_id        uuid NOT NULL REFERENCES employee_scorecards (id)
                      ON DELETE CASCADE,
  /** Recipient user id (the employee for subject; the supervisor for
      supervisor; the owner for owner). */
  recipient_user_id   text NOT NULL,
  /** Privacy tier per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §3. */
  recipient_tier      text NOT NULL,
  /** The rendered nudge body. Subject: full text. Supervisor: redacted
      ≤2-sentence summary. Owner: empty (aggregate stats live in signals
      on the scorecard). */
  content             text NOT NULL DEFAULT '',
  /** Dispatch channel — inapp | email | whatsapp. */
  channel             text NOT NULL DEFAULT 'inapp',
  sent_at             timestamptz,
  audit_hash          text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT perf_nudges_tier_chk CHECK (recipient_tier IN (
    'subject','supervisor','owner'
  )),
  CONSTRAINT perf_nudges_channel_chk CHECK (channel IN (
    'inapp','email','whatsapp'
  ))
);

CREATE INDEX IF NOT EXISTS idx_perf_nudges_recipient
  ON perf_nudges (tenant_id, recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_perf_nudges_scorecard
  ON perf_nudges (scorecard_id);

CREATE INDEX IF NOT EXISTS idx_perf_nudges_tier
  ON perf_nudges (tenant_id, recipient_tier, created_at DESC);

ALTER TABLE perf_nudges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'perf_nudges'
       AND policyname = 'perf_nudges_tenant_isolation'
  ) THEN
    CREATE POLICY perf_nudges_tenant_isolation ON perf_nudges
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
