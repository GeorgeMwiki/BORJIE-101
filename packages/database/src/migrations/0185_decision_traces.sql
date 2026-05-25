-- =============================================================================
-- 0185: decision_traces — F10 DecisionTrace persistence.
--
-- One row per finalised trace emitted by `@borjie/observability`'s
-- decision-trace module. Mirrors LITFIN's structured per-decision trace
-- abstraction: the unit-of-explanation a human auditor cares about.
--
-- This migration:
--   1. Creates the `decision_traces` table — tenant-scoped, with JSONB
--      columns for inputs / branches / attributes / output so the audit
--      shape can survive schema additions without column churn.
--   2. Creates a `(tenant_id, started_at DESC)` index for the admin
--      replay UI's "recent traces for tenant X" list view, plus a
--      `(tenant_id, outcome)` partial-ish index for outcome filtering
--      and a `(name, started_at)` index for cross-tenant operator views.
--   3. Installs the GOLD-STANDARD RLS pattern matching 0182 / 0183 / 0184:
--        * ENABLE + FORCE ROW LEVEL SECURITY
--        * tenant_isolation_select policy (USING)
--        * tenant_isolation_modify policy (FOR ALL, USING + WITH CHECK)
--        * REVOKE ALL FROM anon (defence-in-depth)
--      Tenant-scoped via the canonical `public.current_app_tenant_id()`
--      GUC helper installed by 0172. NULL tenant_id rows are
--      platform-tier (e.g. the tenant-resolution middleware itself
--      recording why it resolved tenant X — at that point a tenant
--      hasn't been bound yet) — service-role only.
--
-- Idempotent: every operation gated on object existence; safe to re-run
-- on a fresh database. The `tenant_tables` array name matches the
-- audit-rls-coverage scanner expectation.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the decision_traces table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS decision_traces (
  id                  TEXT PRIMARY KEY,
  /** NULL = platform-tier decision (no tenant bound at time of decision). */
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL,
  finalised_at        TIMESTAMPTZ NOT NULL,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  inputs              JSONB NOT NULL DEFAULT '{}'::jsonb,
  branches            JSONB NOT NULL DEFAULT '[]'::jsonb,
  chosen_branch_id    TEXT,
  chosen_rationale    TEXT,
  /** Outcome enum stored as TEXT for forward-compat: approved / rejected / executed / refused / failed. */
  outcome             TEXT NOT NULL,
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  output              JSONB,
  error               TEXT,
  user_id             TEXT,
  request_id          TEXT,
  parent_trace_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS decision_traces_tenant_started_idx
  ON decision_traces (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS decision_traces_tenant_outcome_idx
  ON decision_traces (tenant_id, outcome);

CREATE INDEX IF NOT EXISTS decision_traces_name_started_idx
  ON decision_traces (name, started_at DESC);

COMMENT ON TABLE decision_traces IS
  'F10 DecisionTrace persistence — one row per finalised trace from `@borjie/observability`. Tenant-scoped via RLS; service-role bypass for admin replay UI.';

COMMENT ON COLUMN decision_traces.tenant_id IS
  'NULL for platform-tier decisions (e.g. tenant-resolution middleware recording its own decision before a tenant context is bound).';

COMMENT ON COLUMN decision_traces.branches IS
  'JSONB ARRAY of DecisionBranch shapes (id, label, rationale, score?, metadata?, recordedAt). Single column for write-once audit data.';

COMMENT ON COLUMN decision_traces.outcome IS
  'Coarse outcome: approved | rejected | executed | refused | failed. TEXT (not pgEnum) to keep schema evolution cheap.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern.
--
--    Pattern from 0182_section_layouts.sql / 0183_user_action_tracker.sql
--    / 0184_reflexion_buffer_extend.sql:
--      * ENABLE + FORCE ROW LEVEL SECURITY
--      * tenant_isolation_select (USING via current_app_tenant_id())
--      * tenant_isolation_modify (FOR ALL, USING + WITH CHECK)
--      * REVOKE ALL FROM anon
--
--    NULL tenant_id rows are platform-tier and are visible ONLY to the
--    service-role client (which bypasses RLS by default). Authenticated
--    role sees only its own tenant's rows.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'decision_traces'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Enable + force RLS (idempotent).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical names.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT. NULL tenant_id is platform-tier and
      -- invisible to the authenticated role; service-role bypasses RLS
      -- so the admin replay UI still reads everything.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT / UPDATE / DELETE. Writes from authenticated
      -- role must carry a tenant_id matching the GUC. The Supabase store
      -- writer is service-role, so this policy mainly protects against
      -- direct writes from the application path.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth — Supabase REST default
      -- grants anon SELECT on every public table at provisioning).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: write-only path. The application uses a fire-and-forget
-- Supabase service-role client (`SupabaseDecisionTraceStore`); failures
-- never block the decision path. Three retries (250ms / 500ms / 1000ms)
-- then drop with a single warning log. Replay UI reads via service-role.
