-- =============================================================================
-- DOWN 0270: revert mission_drift_log.
--
-- WARNING: DATA LOSS. Dropping the table loses every drift-detection event
-- captured during agency runs — feeds the alignment / safety scoring loop.
--
-- Reverses: 0270_mission_drift_log.sql (CREATE TABLE + RLS).
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.mission_drift_log;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.mission_drift_log;

DROP TABLE IF EXISTS public.mission_drift_log CASCADE;
