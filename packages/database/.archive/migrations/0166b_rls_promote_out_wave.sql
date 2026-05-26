-- =============================================================================
-- 0166: RLS promote-out wave — close the top-5 highest-blast-radius gaps
-- identified by the 2026-05-19 post-PR-90 data-layer sweep §3.
--
-- These tables were on the RLS allowlist with the generic
-- "TRACKED GAP — pre-Phase-D11 schema" reason. They carry the highest
-- sensitivity × mutation-frequency × blast-radius product in the audit:
--
--   R1: sovereign_approvals       — four-eye approval gate carrying PII payloads
--   R2: payment_intents           — money-mover, customer × amount × destination
--   R3: disbursements             — owner payouts with bank credentials
--   R4: gdpr_deletion_requests    — RTBF execution rows; cross-tenant write = forged deletion
--   R5: ai_decision_feedback      — operator verdicts on Brain proposed actions
--   R5: ai_proactive_alerts       — alert payloads with evidence + action plans
--
-- Each table gets:
--   * ENABLE ROW LEVEL SECURITY
--   * FORCE ROW LEVEL SECURITY
--   * tenant_isolation_select policy
--   * tenant_isolation_modify policy (FOR ALL — these are NOT append-only
--     in the same way sovereign_action_ledger is; they need UPDATE for
--     status transitions / ack / resolve)
--   * REVOKE ALL FROM anon
--
-- Idempotent: every operation gated on table existence + DROP IF EXISTS.
--
-- Allowlist follow-up: corresponding entries removed from
-- `scripts/__allowlists__/rls-coverage-allowlist.mjs` so the regression
-- gate ratchets forward.
--
-- Array variable name matches scanner expectation (`tenant_tables`) so
-- the audit-rls-coverage scanner detects the loop-installed policies.
-- =============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'sovereign_approvals',
    'payment_intents',
    'disbursements',
    'gdpr_deletion_requests',
    'ai_decision_feedback',
    'ai_proactive_alerts'
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

      -- Tenant-scoped SELECT.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT/UPDATE/DELETE. These tables are NOT
      -- append-only — status transitions (e.g. sovereign_approval going
      -- pending → approved, gdpr_deletion_request going pending →
      -- executed, ai_proactive_alert getting ack_at) require UPDATE.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: after this migration runs, the audit-rls-coverage
-- scanner will show 93 RLS-enabled tables (was 87) and 120 allowlisted
-- (was 126). The 6 entries removed from the allowlist correspond to the
-- 6 tables enabled above.
