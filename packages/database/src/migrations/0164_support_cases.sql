-- =============================================================================
-- Migration 0164 — support_cases: Mr. Mwikila's PERSISTENT technical-support
-- memory (root-caused payment diagnoses that NEVER vanish across sessions/devices)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Mr. Mwikila is the user's first line of technical support. When a user reports
-- a payment error, the MD root-causes it against the already-populated diagnosis
-- signals (payment_intents.failure_reason, webhook_events / webhook_dead_letters,
-- journal_idempotency, audit_events category=PAYMENT) and opens a `support_case`.
-- That case is the DURABLE MEMORY: on every later turn — a new session, a new
-- device — the brain RECALLS the user's OPEN/active cases (a cheap tenant+user
-- query, never an LLM call) so the MD always remembers "we were debugging your
-- M-Pesa failure; here is what is fixed and what remains".
--
-- The case carries the EVIDENCE that proves the diagnosis (`evidence_ids`: the
-- payment_intent / webhook / audit record ids). This mirrors the CLAUDE.md
-- "evidence-required AI output" rule: a diagnosis with an empty evidence chain is
-- rejected by the inspector before a case is ever opened, and the Auditor agent
-- rejects empty-evidence responses.
--
-- NO MONEY COLUMNS. This table is a SUPPORT/DIAGNOSIS record only. Diagnosis is
-- read-only; any actual fix routes through the existing gated action-executor
-- verbs (LedgerService owns the money path — CLAUDE.md hard rule). There is
-- nothing money-shaped here for any code path to write by mistake.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0162/0163's
--     CORRECT GUC; never the legacy app.tenant_id). REVOKE anon (guarded for
--     vanilla PG / CI empty-PG).
--   * user_id is carried for per-user scoping (the support specialist serves one
--     user's issues) but RLS isolates by TENANT; the app additionally predicates
--     on user_id in every query (belt-and-braces, matching the repo handlers).
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — support_cases
--
-- `steps` is a jsonb array of { label, state:'done'|'remaining'|'blocked', note }
-- so the case can show the user what is fixed / remaining at a glance.
-- `evidence_ids` is a jsonb array of the audit / payment_intent / webhook record
-- ids that PROVE the diagnosis (evidence-required). `root_cause` is the
-- machine-classified cause; `summary` / `resolution` are human-facing.
-- status / severity are TEXT with CHECK constraints (the small closed enums the
-- service uses) — no pg_enum so the migration stays forward-only + re-runnable.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS support_cases (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  thread_id       TEXT,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','diagnosing','awaiting_user','resolved','escalated')),
  severity        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),
  summary         TEXT,
  root_cause      TEXT,
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution      TEXT,
  escalation_ref  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- Recall hot path: "this user's OPEN/active cases for this tenant" — the
-- never-loses-memory query at turn start filters (tenant_id, user_id, status).
CREATE INDEX IF NOT EXISTS support_cases_tenant_user_status_idx
  ON support_cases(tenant_id, user_id, status);

-- Tenant-wide triage / support-queue listing by status.
CREATE INDEX IF NOT EXISTS support_cases_tenant_status_idx
  ON support_cases(tenant_id, status);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0162/0163 §2: current_setting('app.current_tenant_id', true). tenant_id
-- is TEXT so the compare is bare. FOR ALL covers the repo's INSERT + the recall /
-- list SELECT + the status-transition UPDATE. Idempotent: ENABLE/FORCE are no-ops
-- if already set; policy guarded by a pg_policies existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'support_cases'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.support_cases FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'support_cases'
        AND policyname = 'support_cases_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY support_cases_tenant_isolation ON public.support_cases
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.support_cases FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE support_cases IS
  'Mr. Mwikila persistent support memory: one root-caused support/diagnosis case '
  'per user issue (e.g. a payment failure). evidence_ids proves the diagnosis '
  '(evidence-required). Recalled tenant+user-scoped at every brain turn so the MD '
  'never loses memory across sessions/devices. NO money columns — diagnosis is '
  'read-only; fixes route through gated verbs. RLS FORCE on app.current_tenant_id. '
  'Added in 0164.';

COMMIT;
