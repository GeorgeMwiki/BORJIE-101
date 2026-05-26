-- =============================================================================
-- 0093: Webhook DLQ + Delivery Attempts — RLS tenant-isolation
-- =============================================================================
-- Wave 20 Agent L flagged that `webhook_dead_letters` and
-- `webhook_delivery_attempts` (migration 0031) carry a `tenant_id` column
-- but no Row-Level Security policy. The app-layer `WHERE tenant_id = $N`
-- filter was tightened in Wave 20 (getDeadLetter + markDeadLetterReplayed
-- both now take tenantId), but a future caller that forgets the filter
-- would still leak rows.
--
-- This migration closes the DB-layer defense-in-depth gap, matching the
-- `{table}_tenant_isolation` policy pattern used on `tenants`,
-- `properties`, `invoices`, etc.
--
-- Idempotent (DROP POLICY IF EXISTS + CREATE POLICY + ALTER TABLE ENABLE)
-- so repeated runs during dev/CI never fail.
-- =============================================================================

-- --- webhook_dead_letters ---------------------------------------------------
ALTER TABLE webhook_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_dead_letters_tenant_isolation
  ON webhook_dead_letters;

CREATE POLICY webhook_dead_letters_tenant_isolation
  ON webhook_dead_letters
  AS PERMISSIVE
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- --- webhook_delivery_attempts ----------------------------------------------
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_delivery_attempts_tenant_isolation
  ON webhook_delivery_attempts;

CREATE POLICY webhook_delivery_attempts_tenant_isolation
  ON webhook_delivery_attempts
  AS PERMISSIVE
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- --- verification -----------------------------------------------------------
-- After migration, every tenant-scoped HTTP handler that goes through
-- `services/api-gateway/src/middleware/database.ts` (which SETs
-- `app.current_tenant_id` per request) will see only its own rows.
-- Background workers / scheduled jobs that bypass the middleware MUST
-- either call `SET LOCAL app.current_tenant_id = '<tenant>'` before
-- querying or explicitly filter by tenant_id in their SQL.
