-- =============================================================================
-- DOWN 0268: revert mission_checkpoints.
--
-- WARNING: DATA LOSS. Dropping the table loses every "lessons learned"
-- checkpoint emitted during agency runs — critical for post-mortem.
--
-- Reverses: 0268_mission_checkpoints.sql (CREATE TABLE + RLS).
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.mission_checkpoints;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.mission_checkpoints;

DROP TABLE IF EXISTS public.mission_checkpoints CASCADE;
