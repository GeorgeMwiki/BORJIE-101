-- =============================================================================
-- 0028: Maintenance problem taxonomy — Wave 8 gap closure (S7)
-- =============================================================================
-- Customer-research directive: "which problems repeat the most often, just
-- wear and tear. Okay, let's create, have a wide variety of problems that
-- people can choose from, which will be precision."
--
-- Professional maintenance taxonomy, seeded per-tenant so orgs can tailor
-- it without losing the curated baseline. Two tables:
--   - maintenance_problem_categories (top-level: plumbing, electrical, ...)
--   - maintenance_problems (leaf items with severity, default SLA,
--     asset-type scope)
--
-- Seed data lives in packages/database/src/seeds/maintenance-taxonomy.seed.ts
-- and is tenant-scoped so per-org customization is possible.
-- =============================================================================

CREATE TABLE IF NOT EXISTS maintenance_problem_categories (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform default
  code           TEXT NOT NULL,                                   -- plumbing, electrical, hvac, etc.
  name           TEXT NOT NULL,
  description    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 100,
  icon_name      TEXT,                                            -- optional UI hint
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_mp_categories_tenant ON maintenance_problem_categories(tenant_id)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS maintenance_problems (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform default
  category_id    TEXT NOT NULL REFERENCES maintenance_problem_categories(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,                                   -- leaking_tap, blown_fuse, ...
  name           TEXT NOT NULL,
  description    TEXT,
  default_severity TEXT NOT NULL DEFAULT 'medium'
                   CHECK (default_severity IN ('low','medium','high','critical','emergency')),
  default_sla_hours INTEGER NOT NULL DEFAULT 72,                  -- target resolution window
  asset_type_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],       -- empty = applies to all
  room_scope     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],         -- empty = applies to all rooms
  evidence_required BOOLEAN NOT NULL DEFAULT TRUE,
  suggested_vendor_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],  -- 'plumber', 'electrician', ...
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_mp_problems_category ON maintenance_problems(category_id);
CREATE INDEX IF NOT EXISTS idx_mp_problems_tenant ON maintenance_problems(tenant_id)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_mp_problems_severity ON maintenance_problems(tenant_id, default_severity);
