-- =============================================================================
-- Down-migration 0376 — drop the event_outbox service-role bypass policy.
--
-- Dev/staging only. Reverses 0376 by dropping event_outbox_service_role_bypass,
-- reverting `event_outbox` to tenant-isolation-only RLS. WARNING: on a system
-- whose settlement-drain worker drains cross-tenant over the service-role pool,
-- this RE-DARKENS the offtake settlement money leg (the pick/claim will again
-- match zero rows under enforced RLS). Pure RLS metadata — no data touched. Do
-- not run against production.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS event_outbox_service_role_bypass ON event_outbox;

COMMIT;
