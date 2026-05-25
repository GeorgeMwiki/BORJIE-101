-- =============================================================================
-- DOWN 0252: revert land_areas.
--
-- WARNING: DATA LOSS. Dropping the table loses every polygon captured by
-- users (manual draw / GPS walk / GIS import / satellite trace). Run only
-- on dev / staging or after explicit backup + sign-off.
--
-- Reverses: 0252_land_areas.sql (CREATE TABLE land_areas + RLS policies).
-- Idempotent via IF EXISTS guards.
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.land_areas;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.land_areas;

DROP TABLE IF EXISTS public.land_areas CASCADE;
