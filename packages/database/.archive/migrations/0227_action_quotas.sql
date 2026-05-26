-- =============================================================================
-- 0227: action_quotas — Piece E per-tenant / per-persona daily counters.
--
-- One row per (tenant, persona | NULL, date) bucket. Counters incremented by
-- the saga on plan create / approve / execute / money post. Saga rejects new
-- plans when `plans_created` or `budget_micros_used` would exceed the policy
-- ceiling configured elsewhere (the policy ceiling itself lives in
-- `autonomy_caps`).
--
-- The COALESCE-on-NULL primary key idiom: `persona_id IS NULL` means the
-- counter is tenant-wide (all personas roll up here). Per-persona rows
-- coexist with the tenant-wide row.
--
-- Tenant-scoped, FORCE RLS. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_quotas (
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id          TEXT REFERENCES personas(id),
  period_date         DATE NOT NULL,
  plans_created       INTEGER NOT NULL DEFAULT 0 CHECK (plans_created >= 0),
  plans_approved      INTEGER NOT NULL DEFAULT 0 CHECK (plans_approved >= 0),
  plans_executed      INTEGER NOT NULL DEFAULT 0 CHECK (plans_executed >= 0),
  money_micros        INTEGER NOT NULL DEFAULT 0 CHECK (money_micros >= 0),
  budget_micros_used  INTEGER NOT NULL DEFAULT 0 CHECK (budget_micros_used >= 0),
  PRIMARY KEY (tenant_id, COALESCE(persona_id, ''), period_date)
);

CREATE INDEX IF NOT EXISTS idx_action_quotas_period
  ON action_quotas (period_date);

CREATE INDEX IF NOT EXISTS idx_action_quotas_persona
  ON action_quotas (tenant_id, persona_id, period_date) WHERE persona_id IS NOT NULL;

COMMENT ON TABLE action_quotas IS
  'Piece E — daily quota bucket. (tenant, persona|NULL, date) — saga checks before plan create / approve / execute.';

COMMENT ON COLUMN action_quotas.persona_id IS
  'NULL = tenant-wide aggregate row. Non-NULL = per-persona breakdown.';

COMMENT ON COLUMN action_quotas.money_micros IS
  'Total dollar value moved today (sum of POST_LEDGER step amounts converted to micro-USD).';

COMMENT ON COLUMN action_quotas.budget_micros_used IS
  'Total budget consumed today (sum of plan.budget_micros for plans that finished EXECUTING).';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'action_quotas'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
