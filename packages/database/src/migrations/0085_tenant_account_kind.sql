-- =============================================================================
-- Migration 0085 — Tenant Account-Kind + KYC Atoms (Owner/Admin Self-Signup)
--
-- Companion to:
--   - services/api-gateway/src/routes/orgs/signup.hono.ts
--   - apps/owner-web/src/app/signup/page.tsx
--   - packages/database/src/schemas/tenant.schema.ts
--
-- Adds the self-signup discriminator (`account_kind` = individual vs business),
-- the residency/locale beachhead columns the owner cockpit needs at first
-- render (country/currency/language), the KYC atoms (mining licence, BRELA,
-- TIN, VAT, IBAN, NIDA, next-of-kin) and a `kyc_status` lifecycle plus a
-- JSONB `kyc_atoms_completed` array so the compliance plugins can read which
-- atoms a tenant has cleared without touching the migration history.
--
-- Single table touched (`tenants`). All columns use `ADD COLUMN IF NOT EXISTS`
-- so the migration is idempotent. Append-only — IMMUTABLE per CLAUDE.md.
--
-- The "business kind requires business_registration_number once verified" /
-- "individual kind requires national_id once verified" rules cannot be
-- expressed as a single Postgres CHECK without coupling to kyc_status
-- transitions; we enforce them with a single conditional CHECK constraint
-- on the `verified` state and let the application layer
-- (signup.hono.ts + compliance-plugins) handle the intermediate `partial`
-- state by writing to kyc_atoms_completed.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- account_kind — discriminator for the self-signup flow
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'business';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_account_kind_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_account_kind_chk
      CHECK (account_kind IN ('individual', 'business'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- primary_currency — TZS default per CLAUDE.md "Multi-currency, TZS-primary"
-- Accepts the six currencies the platform supports at launch. Domestic
-- non-TZS contracts are still rejected at the API layer; this column is
-- the *display* preference only.
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS primary_currency text NOT NULL DEFAULT 'TZS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_primary_currency_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_primary_currency_chk
      CHECK (primary_currency IN ('TZS', 'USD', 'KES', 'UGX', 'NGN', 'EUR'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- default_language — sw|en per CLAUDE.md "Swahili-first"
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'sw';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_default_language_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_default_language_chk
      CHECK (default_language IN ('sw', 'en'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- country — narrow CHECK constraint for the self-signup form. The existing
-- `country` column on `tenants` is nullable text (legacy ISO-2). We do NOT
-- drop the old column; we add a CHECK so newly-created tenants funnelled
-- through /api/v1/orgs/signup hit a finite enum. Legacy rows with NULL or
-- other ISO codes are tolerated via the nullable-passthrough.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_country_signup_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_country_signup_chk
      CHECK (country IS NULL OR country IN ('TZ', 'KE', 'UG', 'NG', 'OTHER'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- KYC atoms — voluntary at signup, may be required for kyc_status='verified'
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS mining_licence_number text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS business_registration_number text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tax_id text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vat_number text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bank_account_iban text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS national_id_number text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kin_contact jsonb;

-- -----------------------------------------------------------------------------
-- KYC lifecycle — unverified -> partial -> verified
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'unverified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_kyc_status_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_kyc_status_chk
      CHECK (kyc_status IN ('unverified', 'partial', 'verified'));
  END IF;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kyc_atoms_completed jsonb NOT NULL DEFAULT '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- Conditional integrity — if kyc_status='verified' the required atoms
-- per account_kind must be present. The legacy `business` default for
-- old rows is tolerated because their kyc_status is `unverified`.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_kyc_verified_atoms_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_kyc_verified_atoms_chk
      CHECK (
        kyc_status <> 'verified'
        OR (
          (account_kind = 'business' AND business_registration_number IS NOT NULL AND tax_id IS NOT NULL)
          OR
          (account_kind = 'individual' AND national_id_number IS NOT NULL)
        )
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Helpful indices — KYC status + account-kind filters used by admin-web.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tenants_account_kind_idx
  ON tenants (account_kind);

CREATE INDEX IF NOT EXISTS tenants_kyc_status_idx
  ON tenants (kyc_status);

CREATE INDEX IF NOT EXISTS tenants_country_account_kind_idx
  ON tenants (country, account_kind);

COMMIT;
