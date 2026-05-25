-- ============================================================================
-- 0158 — Per-tenant data residency region.
--
-- A2b-3 wire #7 — adds `region` to the tenants table so the encryption
-- port can pick a tenant-local KMS key, and so future query routing can
-- short-circuit cross-region SELECTs that would otherwise breach
-- residency contracts.
--
-- Default of 'eu-west-1' matches the platform default in
-- packages/config/src/schemas.ts (storageSchema.AWS_REGION) so existing
-- tenants are backfilled without operator action.
--
-- Companion edit: tenant.schema.ts gains the same column declaration so
-- Drizzle migrations stay in sync with the runtime schema.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'eu-west-1';

-- Index supports per-region routing queries (e.g. "list tenants pinned
-- to ap-southeast-1 for the residency drill").
CREATE INDEX IF NOT EXISTS tenants_region_idx ON tenants(region);

-- The default keeps existing rows compliant. Tenants that need to opt
-- into a different region are updated via the admin console:
--   UPDATE tenants SET region = 'ap-southeast-1' WHERE id = '...';
