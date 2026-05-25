-- =============================================================================
-- 0228: approval_matrix_dsl_compiled — Piece E compiled DSL rows.
--
-- The approval-matrix DSL is the third major piece of K5 approval policy:
--
--   approval_policies                 — legacy business-action overrides
--   approval_policy_actions           — K5 SOVEREIGN tool-action policy
--   approval_matrix_dsl_compiled      — module/step/amount-routed DSL rules
--
-- The DSL parser compiles human-authored rules like:
--
--   WHEN module = 'estate' AND step = 'POST_LEDGER' AND amount < 500000 TZS
--   THEN approve_by role_group = 'emu_officer' min = 1
--
-- into a `predicate_jsonb` and persists the result here. The evaluator runs
-- predicates against an in-flight ActionStep at execute time to assemble the
-- set of role-groups required to advance.
--
-- `tenant_id` NULL = platform default. Tenant overrides match higher
-- priority (higher integer = higher priority in the evaluator).
--
-- Tenant-scoped, FORCE RLS (with NULL-tenant default read pattern). Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_matrix_dsl_compiled (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  rule_slug             TEXT NOT NULL,
  predicate_jsonb       JSONB NOT NULL,
  required_role_group   TEXT NOT NULL,
  quorum                SMALLINT NOT NULL DEFAULT 1 CHECK (quorum >= 1 AND quorum <= 10),
  notify_role_group     TEXT,
  priority              SMALLINT NOT NULL DEFAULT 100,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (COALESCE(tenant_id, ''), rule_slug)
);

CREATE INDEX IF NOT EXISTS idx_approval_matrix_priority
  ON approval_matrix_dsl_compiled (tenant_id, priority DESC) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_approval_matrix_active
  ON approval_matrix_dsl_compiled (active);

COMMENT ON TABLE approval_matrix_dsl_compiled IS
  'Piece E — compiled approval-matrix DSL rules. Per-tenant overrides on top of platform-default (NULL tenant_id) rows.';

COMMENT ON COLUMN approval_matrix_dsl_compiled.predicate_jsonb IS
  'Compiled predicate: { module, stepKind, amountCmp?, currency?, attributes?, actorPersonaTier? }. Evaluator returns the required role-group when all clauses match.';

COMMENT ON COLUMN approval_matrix_dsl_compiled.required_role_group IS
  'Role-group whose members must approve (e.g. emu_officer, director_general, compliance, civil_engineering).';

COMMENT ON COLUMN approval_matrix_dsl_compiled.notify_role_group IS
  'Optional role-group to NOTIFY before approval routing begins (e.g. Civil Engineering on railway-reserve land).';

COMMENT ON COLUMN approval_matrix_dsl_compiled.priority IS
  'Higher = more specific. Evaluator returns the first matching rule by priority DESC.';

-- ─────────────────────────────────────────────────────────────────────────
-- Seed platform-default + TRC-specific rules.
-- Generic 3 defaults + 3 TRC rules covering rent (<500k EMU, ≥500k DG) and
-- railway-reserve land (Civil Engineering pre-notify).
-- ─────────────────────────────────────────────────────────────────────────

-- Platform defaults (tenant_id IS NULL).

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_default_money_low',
  NULL,
  'default_money_low',
  '{"stepKind":"POST_LEDGER","amountCmp":{"op":"<","valueMicros":100000000000}}'::jsonb,
  'compliance',
  1,
  NULL,
  50,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_default_kill_switch',
  NULL,
  'default_kill_switch_unblock',
  '{"stepKind":"MUTATE_ENTITY","attributes":{"actionPrefix":"kill_switch."}}'::jsonb,
  'four_eye_council',
  2,
  NULL,
  500,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_default_sovereign_external_api',
  NULL,
  'default_sovereign_external_api',
  '{"stepKind":"CALL_EXTERNAL_API","attributes":{"actionPrefix":"sovereign."}}'::jsonb,
  'compliance',
  2,
  NULL,
  400,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

-- TRC EMU pilot — rent <500k → EMU; rent ≥500k → DG; railway-reserve → Civil Eng pre-notify.
-- Amounts in micro-TZS for predicate (the parser converts at compile time).
-- 500,000 TZS = 500_000_000_000 micro-TZS

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_trc_rent_below_500k',
  'trc',
  'trc_rent_below_500k',
  '{"module":"estate","stepKind":"POST_LEDGER","currency":"TZS","amountCmp":{"op":"<","valueMicros":500000000000},"attributes":{"category":"rent"}}'::jsonb,
  'emu_officer',
  1,
  NULL,
  200,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_trc_rent_500k_plus',
  'trc',
  'trc_rent_500k_plus',
  '{"module":"estate","stepKind":"POST_LEDGER","currency":"TZS","amountCmp":{"op":">=","valueMicros":500000000000},"attributes":{"category":"rent"}}'::jsonb,
  'director_general',
  1,
  NULL,
  210,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

INSERT INTO approval_matrix_dsl_compiled (
  id, tenant_id, rule_slug, predicate_jsonb, required_role_group, quorum,
  notify_role_group, priority, active
) VALUES (
  'amdc_trc_railway_reserve_notify',
  'trc',
  'trc_railway_reserve_notify',
  '{"module":"estate","stepKind":"MUTATE_ENTITY","attributes":{"landKind":"railway_reserve"}}'::jsonb,
  'director_general',
  1,
  'civil_engineering',
  300,
  TRUE
) ON CONFLICT (COALESCE(tenant_id, ''), rule_slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern — with allow-read of NULL-tenant defaults.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'approval_matrix_dsl_compiled'
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

      -- SELECT: tenant rows OR NULL-tenant (platform default) — every tenant
      -- needs the defaults visible at evaluator time.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id IS NULL OR tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- WRITE: tenant-scoped only — platform defaults are seeded migrations,
      -- not user writes.
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
