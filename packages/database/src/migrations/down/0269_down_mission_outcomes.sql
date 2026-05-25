-- =============================================================================
-- DOWN 0269: revert mission_outcomes.
--
-- WARNING: DATA LOSS. Dropping the table loses every settlement row for
-- Piece Q runs — success/fail attribution + scoring history.
--
-- Reverses: 0269_mission_outcomes.sql (CREATE TABLE + RLS).
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.mission_outcomes;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.mission_outcomes;

DROP TABLE IF EXISTS public.mission_outcomes CASCADE;
