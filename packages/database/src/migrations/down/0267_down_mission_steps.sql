-- =============================================================================
-- DOWN 0267: revert mission_steps.
--
-- WARNING: DATA LOSS. Dropping the table loses every executed step in the
-- Piece Q agency loop — planning trace, tool calls, intermediate results.
--
-- Reverses: 0267_mission_steps.sql (CREATE TABLE + RLS).
-- Idempotent. Down 0266 already CASCADEs this — keeping a targeted down
-- so each step can be reverted independently if 0266 stays.
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.mission_steps;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.mission_steps;

DROP TABLE IF EXISTS public.mission_steps CASCADE;
