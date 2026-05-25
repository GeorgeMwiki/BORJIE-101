-- =============================================================================
-- DOWN 0266: revert agency_missions.
--
-- WARNING: DATA LOSS + CASCADE. Dropping agency_missions drops the entire
-- Piece Q chain — mission_steps (0267), mission_checkpoints (0268),
-- mission_outcomes (0269), mission_drift_log (0270) all reference back.
-- All long-horizon agency runs and their telemetry are lost.
--
-- Reverses: 0266_agency_missions.sql (CREATE TABLE + RLS).
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.agency_missions;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.agency_missions;

DROP TABLE IF EXISTS public.agency_missions CASCADE;
