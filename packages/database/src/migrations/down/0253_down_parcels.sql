-- =============================================================================
-- DOWN 0253: revert parcels.
--
-- WARNING: DATA LOSS. Dropping the table loses every parcel subdivision,
-- evidence linkage, and marketplace history.
--
-- Reverses: 0253_parcels.sql (CREATE TABLE parcels + RLS policies). The
-- CASCADE drops all referencing tables created by 0254..0260 (metadata,
-- evidence docs, listings, activity_log, color_tags, inquiries, indexes).
-- Run only on dev / staging or after explicit backup + sign-off.
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation_select ON public.parcels;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.parcels;

DROP TABLE IF EXISTS public.parcels CASCADE;
