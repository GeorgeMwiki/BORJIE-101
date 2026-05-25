-- ─────────────────────────────────────────────────────────────────────
-- Migration 0146 — CoT reservoir row-level-security policy.
--
-- Phase D / D3 — Comprehensive gap closure.
--
-- Closes the A4-surfaced regulator gap: `kernel_cot_reservoir.thoughtText`
-- stores PII-scrubbed but still subject-attributable chain-of-thought
-- text. Without DB-level tenant isolation, a bug in the api-gateway
-- could leak tenant A's CoT to tenant B. RLS enforces isolation at the
-- substrate layer so application-level escapes can't bypass it.
--
-- Strategy
-- ────────
-- The application connects with a role that has `RLS = ON`. Each
-- request sets `app.tenant_id` to the caller's JWT tenantId via
-- `SET LOCAL app.tenant_id = '<id>'` inside the request transaction
-- (the existing `tenant-context.middleware.ts` already does this for
-- routers that opt in). The policy below restricts SELECT/UPDATE/
-- DELETE to rows whose `tenant_id` matches that GUC. Rows with a
-- NULL tenant_id (platform-scope thoughts, e.g. industry-tier
-- reasoning) are visible to no tenant — they are inspectable only by
-- a maintenance role that bypasses RLS.
--
-- Platform admins (the SUPER_ADMIN flow used by the new
-- `GET /api/v1/cot/query` route) should connect with a role that has
-- `BYPASSRLS` or set `app.tenant_id = '__all__'` after explicit role
-- check + audit; that path is handled in the api-gateway composition
-- root, NOT here.
--
-- Idempotent — all statements use `IF NOT EXISTS` (or `DROP POLICY
-- IF EXISTS` then `CREATE`) so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Enable RLS on the reservoir. `ENABLE ROW LEVEL SECURITY` is a
--    one-way switch — repeated calls are safe and a no-op.
ALTER TABLE IF EXISTS kernel_cot_reservoir
  ENABLE ROW LEVEL SECURITY;

-- 2) Force RLS even for the table owner. Without this, the owner
--    silently bypasses every policy — a common cause of "RLS works in
--    test but leaks in prod".
ALTER TABLE IF EXISTS kernel_cot_reservoir
  FORCE ROW LEVEL SECURITY;

-- 3) Tenant-isolation policy. Postgres has no `CREATE POLICY IF NOT
--    EXISTS`, so we DROP-then-CREATE inside a DO block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'kernel_cot_reservoir') THEN
    DROP POLICY IF EXISTS cot_tenant_isolation ON kernel_cot_reservoir;
    CREATE POLICY cot_tenant_isolation ON kernel_cot_reservoir
      USING (
        -- NULL tenant_id rows are platform-scope and invisible via this policy.
        -- The GUC is a TEXT — cast tenant_id to TEXT for the comparison
        -- (handles both TEXT and UUID schemas without a schema rewrite).
        tenant_id::text = current_setting('app.tenant_id', true)
      );

    -- INSERT policy — writers must stamp the row's tenant_id with
    -- their own GUC. Prevents a compromised writer from cross-tenant
    -- forging CoT rows.
    DROP POLICY IF EXISTS cot_tenant_isolation_write ON kernel_cot_reservoir;
    CREATE POLICY cot_tenant_isolation_write ON kernel_cot_reservoir
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true)
      );
  END IF;
END $$;

-- 4) Optional comment so a DBA `\d+ kernel_cot_reservoir` sees the policy intent.
COMMENT ON TABLE kernel_cot_reservoir IS
  'Sampled chain-of-thought. RLS isolated by `app.tenant_id` GUC (migration 0146). Read via /api/v1/cot/query admin route; default returns persist-boundary-scrubbed text. include_raw=true requires `cot:read:raw` scope.';
