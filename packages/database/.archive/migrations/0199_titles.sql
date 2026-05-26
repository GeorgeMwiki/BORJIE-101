-- ─────────────────────────────────────────────────────────────────────
-- Migration 0199 — Titles (Piece D).
--
-- TENANT-DEFINED job labels mapped onto a FIXED five-level power-tier
-- hierarchy. The brain and policy gate operate on `power_tier` ONLY;
-- the `display_name_*` columns are how tenants address their users
-- (TRC: "Director General"; hotel: "General Manager"; university:
-- "Vice-Chancellor" — all power_tier = 2).
--
-- Tiers (locked):
--   1 = OWNER     — org founder / board / ultimate auth
--   2 = ADMIN     — top operational lead (DG / CEO / GM / VC)
--   3 = MANAGER   — dept/region/module head
--   4 = EMPLOYEE  — field staff
--   5 = CUSTOMER  — external (lessee / guest / student / vendor)
--
-- Built-in titles (one per tier) are seeded by `seedBuiltInTitles`
-- in `@borjie/persona-runtime` when a tenant is created. Tenants
-- may add jurisdictional / industry-specific titles at runtime.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS titles (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug                        TEXT NOT NULL,
  display_name_en             TEXT NOT NULL,
  display_name_sw             TEXT,
  power_tier                  SMALLINT NOT NULL CHECK (power_tier BETWEEN 1 AND 5),
  is_built_in                 BOOLEAN NOT NULL DEFAULT FALSE,
  icon                        TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_titles_tenant
  ON titles (tenant_id);

CREATE INDEX IF NOT EXISTS idx_titles_tenant_tier
  ON titles (tenant_id, power_tier);

CREATE INDEX IF NOT EXISTS idx_titles_builtin
  ON titles (is_built_in) WHERE is_built_in = TRUE;

COMMENT ON TABLE titles IS
  'Piece D — tenant-defined labels mapped to a fixed 5-tier hierarchy. Brain routes on power_tier; tenants relabel for their jurisdiction/industry.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS titles FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'titles') THEN
    DROP POLICY IF EXISTS titles_tenant_isolation ON titles;
    CREATE POLICY titles_tenant_isolation ON titles
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS titles_tenant_isolation_write ON titles;
    CREATE POLICY titles_tenant_isolation_write ON titles
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Now that `titles` exists, add the FK from persona_bindings.title_id.
-- The 0196 migration left this as a soft TEXT column.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'persona_bindings')
     AND EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'titles') THEN
    BEGIN
      ALTER TABLE persona_bindings
        ADD CONSTRAINT persona_bindings_title_fk
        FOREIGN KEY (title_id) REFERENCES titles(id);
    EXCEPTION WHEN duplicate_object THEN
      -- FK already exists — idempotent re-run.
      NULL;
    END;
  END IF;
END $$;
