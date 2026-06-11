-- =============================================================================
-- DOWN 0338 — restore the literal country CHECK constraints (0085/0087 shape).
-- NOTE: restoring the literal lists will fail if rows exist with countries
-- outside them (i.e. markets enabled after 0338) — by design: the down is only
-- safe before any new market has signed up. Idempotent guards throughout.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'tenants_country_shape_chk'
         AND conrelid = 'public.tenants'::regclass
    ) THEN
      ALTER TABLE tenants DROP CONSTRAINT tenants_country_shape_chk;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'tenants_country_chk'
         AND conrelid = 'public.tenants'::regclass
    ) THEN
      ALTER TABLE tenants
        ADD CONSTRAINT tenants_country_chk
        CHECK (country IS NULL OR country IN ('TZ', 'KE', 'UG', 'NG', 'OTHER'));
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.buyers') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'buyers_country_shape_chk'
         AND conrelid = 'public.buyers'::regclass
    ) THEN
      ALTER TABLE buyers DROP CONSTRAINT buyers_country_shape_chk;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'buyers_country_signup_chk'
         AND conrelid = 'public.buyers'::regclass
    ) THEN
      ALTER TABLE buyers
        ADD CONSTRAINT buyers_country_signup_chk
        CHECK (country IN ('TZ','KE','UG','NG','CN','IN','AE','EU','OTHER'));
    END IF;
  END IF;
END $$;

COMMIT;
