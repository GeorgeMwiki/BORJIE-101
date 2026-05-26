-- =============================================================================
-- 0168: Kill-switch feature flags — high-risk operation guards
-- =============================================================================
-- Seeds the three platform-wide kill-switch flags consumed by the api-gateway
-- middleware at `services/api-gateway/src/middleware/kill-switch.middleware.ts`.
--
-- These flags are read-by-default-OFF (default_enabled = FALSE): the only
-- way to fire a kill-switch is for an operator to flip the per-tenant
-- override via `PUT /api/v1/feature-flags/:key { enabled: true }`. When
-- the override is true, the middleware short-circuits with 503
-- KILL_SWITCH_ACTIVE and writes a CRITICAL audit event.
--
-- Without these seed rows the override endpoint would reject the operator's
-- `PUT` with UNKNOWN_FLAG (404) because the validator demands the flag
-- exists in the catalog before overrides can be written.
--
-- Idempotent: re-running the migration is safe (`ON CONFLICT (flag_key)
-- DO NOTHING`).
-- =============================================================================

INSERT INTO feature_flags (id, flag_key, description, default_enabled)
VALUES
  ('ff_killswitch_eviction',          'killswitch_eviction',
   'Kill-switch: when ON, blocks POST /leases/:id/terminate (eviction). '
   'Fires CRITICAL audit event and returns 503 KILL_SWITCH_ACTIVE. '
   'Default OFF; operators toggle per-tenant via /api/v1/feature-flags/:key.', FALSE),
  ('ff_killswitch_payment_reversal',  'killswitch_payment_reversal',
   'Kill-switch: when ON, blocks payment mutations (POST /payments, '
   'POST /payments/:id/process). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE),
  ('ff_killswitch_account_deletion',  'killswitch_account_deletion',
   'Kill-switch: when ON, blocks GDPR right-to-be-forgotten flows '
   '(POST /gdpr/delete-request and .../execute). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE)
ON CONFLICT (flag_key) DO NOTHING;
