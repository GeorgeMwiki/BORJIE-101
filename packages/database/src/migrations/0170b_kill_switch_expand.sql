-- =============================================================================
-- 0170: Kill-switch feature flags — DA3 expansion (refund, data-export,
--       monthly-close-reverse, sublease-cancel, sovereign-ledger-override)
-- =============================================================================
-- Expands the kill-switch coverage from 3 to 8 high-risk operation flags. The
-- api-gateway middleware at `services/api-gateway/src/middleware/kill-switch
-- .middleware.ts` is the consumer; this migration seeds the five additional
-- flag rows so the override endpoint (`PUT /api/v1/feature-flags/:key`) won't
-- reject operator toggles with UNKNOWN_FLAG (404).
--
-- Pattern mirrors `0168b_kill_switch_feature_flags.sql`:
--   - `default_enabled = FALSE` — the only way to fire a kill-switch is for
--     an operator to flip the per-tenant override.
--   - When the override is true, the middleware short-circuits with
--     `503 KILL_SWITCH_ACTIVE` and writes a CRITICAL audit event.
--   - Snake-case keys to satisfy the service validator `/^[a-z][a-z0-9_]*$/`.
--
-- Coverage added (audit ref: DA3 in `.audit/deep-audit-2026-05-20.md`):
--   1. killswitch_refund                     → POST /move-out/:leaseId/finalize
--   2. killswitch_data_export                → GET  /dsar/:subjectId/export
--   3. killswitch_monthly_close_reverse      → POST /monthly-close/trigger
--   4. killswitch_sublease_cancel            → POST /sublease/:id/revoke
--   5. killswitch_sovereign_ledger_override  → POST /admin/sovereign-ledger/verify
--
-- Idempotent: re-running the migration is safe (`ON CONFLICT (flag_key)
-- DO NOTHING`).
-- =============================================================================

INSERT INTO feature_flags (id, flag_key, description, default_enabled)
VALUES
  ('ff_killswitch_refund',                    'killswitch_refund',
   'Kill-switch: when ON, blocks deposit refund finalize (POST /move-out/:leaseId/finalize). '
   'Fires CRITICAL audit event and returns 503 KILL_SWITCH_ACTIVE. '
   'Default OFF; operators toggle per-tenant via /api/v1/feature-flags/:key.', FALSE),
  ('ff_killswitch_data_export',               'killswitch_data_export',
   'Kill-switch: when ON, blocks DSAR data-subject bundle exports '
   '(GET /dsar/:subjectId/export). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE),
  ('ff_killswitch_monthly_close_reverse',     'killswitch_monthly_close_reverse',
   'Kill-switch: when ON, blocks monthly-close orchestrator triggers '
   '(POST /monthly-close/trigger). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE),
  ('ff_killswitch_sublease_cancel',           'killswitch_sublease_cancel',
   'Kill-switch: when ON, blocks sublease revocations '
   '(POST /sublease/:id/revoke). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE),
  ('ff_killswitch_sovereign_ledger_override', 'killswitch_sovereign_ledger_override',
   'Kill-switch: when ON, blocks sovereign action-ledger admin overrides '
   '(POST /admin/sovereign-ledger/verify). Fires CRITICAL audit + 503. '
   'Default OFF; operators toggle per-tenant.', FALSE)
ON CONFLICT (flag_key) DO NOTHING;
