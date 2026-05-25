-- =============================================================================
-- DOWN 0264: revert layout_overrides.
--
-- WARNING: DATA LOSS. Dropping the table loses every per-user section
-- pin/dismiss/reorder preference (Piece O — Adaptive Layout Engine).
--
-- Reverses: 0264_layout_overrides.sql (CREATE TABLE + RLS).
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.layout_overrides;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.layout_overrides;

DROP TABLE IF EXISTS public.layout_overrides CASCADE;
