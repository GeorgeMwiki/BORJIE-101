-- Phase D / A2b-3, 2026-05-21 — RLS GUC unification (Supabase audit F2).
--
-- ─────────────────────────────────────────────────────────────────────
-- Problem
-- ─────────────────────────────────────────────────────────────────────
-- Two GUC names coexisted across the migration history and the
-- application boundary:
--
--   GUC name              | Set by gateway? | Read by policies
--   ──────────────────────┼─────────────────┼──────────────────────────
--   app.current_tenant_id | YES (services/  | 0003, 0005, 0032, 0093,
--                         |  api-gateway/   |  0111 — inline current_
--                         |  src/middleware/|  setting(...) calls
--                         |  database.ts)   |
--   app.tenant_id         | NO              | 0146 inline, 0155 helper,
--                         |                 |  0156 helper, 0169 helper
--
-- Because the gateway only ever calls
--   `SELECT set_config('app.current_tenant_id', '<uuid>', false)`
-- every policy that compared against `app.tenant_id` evaluated to
-- `NULL = <tenant_id>` which is NULL — Postgres treats that as FALSE
-- under RLS, so authenticated requests saw ZERO rows on ~70 tables.
-- The same connection accessed via the Supabase `service_role`
-- bypassed RLS entirely (BYPASSRLS on the role), so manual ops
-- never noticed the gap. Effectively the multi-tenant defence-in-
-- depth layer was dead for the authenticated role.
--
-- ─────────────────────────────────────────────────────────────────────
-- Fix strategy — single point of change (Path B in the F2 ticket)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Redefine `public.current_app_tenant_id()` to read
--    `app.current_tenant_id` (the name the gateway actually sets),
--    falling back to `app.tenant_id` for back-compat with any out-of-
--    band tooling (e.g. dbt seeds, psql sessions) that may have been
--    written against the old name. The fallback is deliberately last
--    so the canonical name wins.
--
-- 2) Replace the two INLINE policies on `kernel_cot_reservoir` (from
--    0146) that reference `current_setting('app.tenant_id', true)`
--    directly. The replacement routes them through the helper so a
--    future GUC rename is again a one-line change. 0146 itself is
--    NOT edited — replaying 0146 followed by 0172 produces the
--    correct end state.
--
-- 3) Migrations 0166 / 0167 do not reference any GUC and need no
--    change.
--
-- 4) Migrations 0003 / 0005 / 0032 / 0093 / 0111 inline
--    `current_setting('app.current_tenant_id', ...)` — they already
--    match the gateway and are LEFT ALONE. The helper now also reads
--    the same name, so the two paths agree.
--
-- ─────────────────────────────────────────────────────────────────────
-- Why redefine the helper rather than change the gateway
-- ─────────────────────────────────────────────────────────────────────
-- Changing the gateway to set `app.tenant_id` would either (a) break
-- the 5 older policies that hard-code `app.current_tenant_id`, or
-- (b) force the gateway to issue TWO `set_config` calls per request.
-- Redefining the helper is a single DDL change that converges every
-- policy on the gateway's existing GUC name with no behaviour change
-- elsewhere.
--
-- ─────────────────────────────────────────────────────────────────────
-- Verification (post-deploy)
-- ─────────────────────────────────────────────────────────────────────
--   SET app.current_tenant_id = '00000000-0000-0000-0000-000000000001';
--   SELECT public.current_app_tenant_id();
--   -- expected: 00000000-0000-0000-0000-000000000001
--
--   RESET app.current_tenant_id;
--   SET app.tenant_id        = '00000000-0000-0000-0000-000000000002';
--   SELECT public.current_app_tenant_id();
--   -- expected: 00000000-0000-0000-0000-000000000002 (legacy fallback)
--
--   RESET app.tenant_id;
--   SELECT public.current_app_tenant_id();
--   -- expected: NULL (fail-closed default)

-- ============================================================================
-- 1. Redefine the canonical tenant-id helper to read what the gateway sets
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_tenant_id', TRUE), '')::uuid,
    NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid
  );
$$;

COMMENT ON FUNCTION public.current_app_tenant_id IS
  'Returns the per-transaction tenant_id GUC set by the api-gateway '
  'middleware. Primary source is `app.current_tenant_id` (canonical, '
  'aligned with set_config call site at services/api-gateway/src/'
  'middleware/database.ts:~319). Falls back to legacy `app.tenant_id` '
  'so 0146-era out-of-band tooling continues to work. Returns NULL '
  'when neither is set so RLS policies deny by default. Marked STABLE '
  'so the planner can hoist the call out of inner loops. Unified by '
  'migration 0172 (Supabase audit F2).';

-- ============================================================================
-- 2. Re-route the two inline 0146 policies through the helper
-- ============================================================================
-- 0146 created `cot_tenant_isolation` (SELECT) and
-- `cot_tenant_isolation_write` (INSERT) on `kernel_cot_reservoir`
-- with hard-coded `current_setting('app.tenant_id', true)` predicates.
-- Recreate them through the helper so they pick up the unified GUC
-- name. Idempotent via DROP IF EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'kernel_cot_reservoir'
  ) THEN
    DROP POLICY IF EXISTS cot_tenant_isolation ON public.kernel_cot_reservoir;
    DROP POLICY IF EXISTS cot_tenant_isolation_write ON public.kernel_cot_reservoir;

    -- SELECT — readers see only rows whose tenant_id matches the GUC.
    -- NULL tenant_id rows remain platform-scope and stay invisible
    -- here (the helper returns NULL when unset, and `NULL = NULL` is
    -- NULL under SQL, which RLS treats as FALSE).
    CREATE POLICY cot_tenant_isolation ON public.kernel_cot_reservoir
      USING (tenant_id::uuid = public.current_app_tenant_id());

    -- INSERT — writers must stamp the row's tenant_id with their own
    -- GUC value. Prevents a compromised writer from forging cross-
    -- tenant CoT rows. NULL row.tenant_id is allowed for legitimate
    -- platform-scope writes.
    CREATE POLICY cot_tenant_isolation_write ON public.kernel_cot_reservoir
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id::uuid = public.current_app_tenant_id()
      );
  END IF;
END $$;

-- ============================================================================
-- 3. Operator note
-- ============================================================================
-- After this migration runs:
--   * Every authenticated request, on every RLS-protected table, sees
--     its own tenant's rows (no longer the silent-empty failure mode).
--   * The `service_role` Supabase role continues to BYPASSRLS at the
--     role level, unchanged.
--   * Any forgotten `set_config` call in a worker still fails CLOSED
--     (helper returns NULL → policy denies). The fail-closed contract
--     is preserved.
--   * Out-of-band tooling that historically set `app.tenant_id`
--     continues to work via the COALESCE fallback.
