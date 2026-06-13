-- =============================================================================
-- Down-migration 0354 — drop the reminders service-role bypass policy.
--
-- Dev/staging only. Reverses 0354 by dropping reminders_service_role_bypass,
-- reverting `reminders` to tenant-isolation-only RLS. WARNING: on a system
-- whose reminders-dispatch worker drains cross-tenant over the service-role
-- pool, this RE-DARKENS the reminders loop (the claim will again match zero
-- rows). Pure RLS metadata — no data touched. Do not run against production.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS reminders_service_role_bypass ON reminders;

COMMIT;
