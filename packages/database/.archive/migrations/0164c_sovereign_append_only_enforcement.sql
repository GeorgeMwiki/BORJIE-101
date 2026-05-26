-- =============================================================================
-- 0164: Sovereign action ledger + audit-style tables — append-only enforcement.
--
-- Closes CRITICAL findings D1 / 1.1 / 1.2 from the 2026-05-19 post-PR-90
-- data-layer bug sweep:
--
--   1.1 sovereign_action_ledger has NO append-only triggers (unlike
--       ai_audit_chain, which got triggers in migration 0127).
--   1.2 0156 installed `FOR ALL` RLS on sovereign_action_ledger,
--       agency_run_checkpoints, kernel_memory_*, reflexion_buffer,
--       intelligence_history, sensor_call_log — allowing UPDATE/DELETE
--       through the policy layer.
--
-- This migration:
--   * Installs BEFORE UPDATE/DELETE row triggers + BEFORE TRUNCATE
--     statement trigger on `sovereign_action_ledger`, mirroring the
--     pattern in migration 0127 for `ai_audit_chain`. SECURITY DEFINER
--     with a fixed `search_path = pg_catalog` so the trigger cannot be
--     bypassed via a malicious caller search path.
--   * Replaces the 0156 `FOR ALL` `tenant_isolation_modify` policy on
--     the audit/log/ledger tables with `FOR SELECT` + `FOR INSERT`
--     policies. UPDATE/DELETE/TRUNCATE are blocked at both layers
--     (policy and trigger for the hash-chained tables; policy only
--     for the structurally-append-only logs).
--
-- Hash-chained tables (also get triggers — REQUIRED, not just nice-to-have):
--   * sovereign_action_ledger  (this migration)
--   * ai_audit_chain           (already covered by 0127)
--
-- Append-only-by-policy tables (no UPDATE/DELETE through RLS, but no
-- engine-level trigger because their structural append-only is enforced
-- elsewhere or they are too high-velocity for trigger overhead):
--   * agency_run_checkpoints
--   * kernel_memory_episodic
--   * kernel_memory_semantic
--   * kernel_memory_procedural
--   * kernel_memory_reflective
--   * reflexion_buffer
--   * intelligence_history
--   * sensor_call_log
--
-- Idempotent: every CREATE / DROP is `IF NOT EXISTS` / `IF EXISTS`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Engine-level append-only triggers on sovereign_action_ledger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sovereign_action_ledger_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'sovereign_action_ledger is append-only: % operations are not permitted (row id=%, tenant_id=%)',
    TG_OP,
    COALESCE(OLD.id, ''),
    COALESCE(OLD.tenant_id, '')
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION public.sovereign_action_ledger_block_mutation() IS
  '0164 — engine-level append-only enforcement for sovereign_action_ledger. Refuses UPDATE/DELETE. SECURITY DEFINER + fixed search_path so it cannot be bypassed via a malicious session search path.';

DROP TRIGGER IF EXISTS sovereign_action_ledger_no_update ON public.sovereign_action_ledger;
CREATE TRIGGER sovereign_action_ledger_no_update
  BEFORE UPDATE ON public.sovereign_action_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.sovereign_action_ledger_block_mutation();

DROP TRIGGER IF EXISTS sovereign_action_ledger_no_delete ON public.sovereign_action_ledger;
CREATE TRIGGER sovereign_action_ledger_no_delete
  BEFORE DELETE ON public.sovereign_action_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.sovereign_action_ledger_block_mutation();

-- TRUNCATE bypasses row-level triggers; a statement-level trigger covers it.
CREATE OR REPLACE FUNCTION public.sovereign_action_ledger_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'sovereign_action_ledger is append-only: TRUNCATE is not permitted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS sovereign_action_ledger_no_truncate ON public.sovereign_action_ledger;
CREATE TRIGGER sovereign_action_ledger_no_truncate
  BEFORE TRUNCATE ON public.sovereign_action_ledger
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.sovereign_action_ledger_block_truncate();

COMMENT ON TABLE public.sovereign_action_ledger IS
  'Append-only sovereign-tier action ledger. UPDATE/DELETE/TRUNCATE refused at trigger level (migration 0164). Each row hash-chained to its predecessor via prev_hash → this_hash. See packages/database/src/services/sovereign-action-ledger.service.ts.';

-- ---------------------------------------------------------------------------
-- 2. Partial-unique on per-tenant genesis row.
--
-- HIGH 1.5 — without a DB-level constraint, an attacker that can insert
-- can craft a parallel chain: insert a SECOND row with prev_hash =
-- GENESIS_HASH so the verifier silently picks one branch and misses the
-- other. A unique partial index over (tenant_id) WHERE prev_hash = the
-- 64-zero genesis string ensures EXACTLY one genesis row per tenant.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sovereign_action_ledger_genesis_per_tenant
  ON public.sovereign_action_ledger (tenant_id)
  WHERE prev_hash = '0000000000000000000000000000000000000000000000000000000000000000';

COMMENT ON INDEX public.uniq_sovereign_action_ledger_genesis_per_tenant IS
  '0164 — partial unique index pinning at most one genesis row per tenant. Prevents fork attacks where a second row carrying prev_hash = GENESIS_HASH would create a parallel chain the verifier could silently miss.';

-- ---------------------------------------------------------------------------
-- 3. Replace 0156 `FOR ALL` policy with `FOR SELECT` + `FOR INSERT` on
--    every audit/log/ledger-style tenant table.
--
-- 0156 used `FOR ALL` (USING + WITH CHECK) which permits UPDATE/DELETE
-- through the policy. For append-only surfaces, we want:
--   * Reads:   tenant-scoped SELECT (USING tenant_id = current)
--   * Writes:  tenant-scoped INSERT (WITH CHECK tenant_id = current)
--   * UPDATE/DELETE: REFUSED — no policy means no permission.
--
-- The hash-chained tables (sovereign_action_ledger) get a second layer
-- of defence through the row-level trigger above. The non-hash-chained
-- tables rely on the policy layer; that is acceptable for memory /
-- log surfaces that operators retire via dedicated migration paths.
--
-- Array variable name matches scanner expectation (`tenant_tables`) so
-- the audit-rls-coverage scanner detects the loop-installed policies.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'sovereign_action_ledger',
    'agency_run_checkpoints',
    'kernel_memory_episodic',
    'kernel_memory_semantic',
    'kernel_memory_procedural',
    'kernel_memory_reflective',
    'reflexion_buffer',
    'intelligence_history',
    'sensor_call_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Drop the prior FOR ALL policy installed by 0156.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );
      -- Also drop the SELECT policy we are about to recreate (idempotent).
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I;', tbl
      );

      -- SELECT — tenant-scoped reads.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- INSERT — tenant-scoped appends. UPDATE/DELETE deliberately absent.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_insert ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- RLS must remain enabled + forced (0156 set this; reassert for safety).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Revoke anon access (re-asserted from 0156).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Operator note.
-- ---------------------------------------------------------------------------
-- After this migration runs, attempting `UPDATE sovereign_action_ledger
-- SET payload_json = '{"hacked":true}' WHERE id = '...';` will fail with
-- SQLSTATE 42501 (insufficient_privilege) at the trigger layer even if
-- the calling role somehow bypasses RLS (e.g. service_role with
-- BYPASSRLS). The append-only contract is now enforced in TWO layers
-- (policy + trigger) for sovereign_action_ledger.
--
-- For the non-hash-chained tables, only the policy layer enforces
-- append-only. Operators with BYPASSRLS roles (e.g. postgres / Supabase
-- service_role) can still UPDATE/DELETE — by design, because retention
-- sweeps require it. The application connection (authenticated role)
-- cannot.
