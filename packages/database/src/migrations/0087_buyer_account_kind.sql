-- =============================================================================
-- Migration 0087 — Buyer Account-Kind + KYC Atoms (Buyer Self-Signup)
--
-- Companion to:
--   - services/api-gateway/src/routes/buyers/signup.hono.ts
--   - apps/buyer-mobile/app/auth/signup/*
--   - packages/database/src/schemas/buyer-extensions.schema.ts
--
-- Adds the buyer self-signup discriminator (`account_kind` = individual vs
-- business), business-kind sub-type (refiner|broker|fabricator|investor|other),
-- locale beachhead columns (country / preferred_currency / preferred_language),
-- full_name + national_id + tax_id + business_registration_number identity
-- atoms, KYC lifecycle (`kyc_status`), the JSONB `kyc_atoms_completed` array,
-- and the informational wallet/bid-limit minor-units columns.
--
-- All columns use ADD COLUMN IF NOT EXISTS — idempotent. Append-only.
-- IMMUTABLE per CLAUDE.md "Migrations are immutable".
--
-- The application layer (signup.hono.ts + buyers-kyc.hono.ts) enforces the
-- "business kind requires business_registration_number once verified" /
-- "individual kind requires national_id once verified" rules via state
-- transitions on kyc_status; we keep the CHECK constraints structural only
-- (which values are allowed, not which combinations are required when).
--
-- RLS: buyers carries `tenant_id` already and was created in the canonical
-- mining schema with RLS FORCE-enabled. This migration only adds columns —
-- no policy changes required.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- account_kind — INDIVIDUAL (personal capacity) vs BUSINESS (org)
-- Default 'business' preserves backfill semantics — every existing buyer row
-- predates this migration and was created as an organisational counterparty.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'business';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_account_kind_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_account_kind_chk
      CHECK (account_kind IN ('individual', 'business'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- business_kind — refiner / broker / fabricator / investor / other
-- NULL when account_kind = 'individual'.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS business_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_business_kind_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_business_kind_chk
      CHECK (
        business_kind IS NULL
        OR business_kind IN ('refiner','broker','fabricator','investor','other')
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- org_name — required when business; NULL when individual
-- (legal entity name, separate from the `name` column which carries a display
-- handle for the buyer record).
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS org_name text;

-- -----------------------------------------------------------------------------
-- country — TZ default per launch beachhead. Re-asserts the canonical buyers
-- country column without disturbing the existing default; the new CHECK
-- constraint widens the allowed set to cover cross-border buyer jurisdictions.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_country_signup_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_country_signup_chk
      CHECK (country IN ('TZ','KE','UG','NG','CN','IN','AE','EU','OTHER'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- preferred_currency — USD default (refiners + LBMA quote in USD).
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS preferred_currency text NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_preferred_currency_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_preferred_currency_chk
      CHECK (preferred_currency IN ('USD','TZS','KES','EUR','CNY','INR'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- preferred_language — sw default per CLAUDE.md "Swahili-first" hard rule.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'sw';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_preferred_language_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_preferred_language_chk
      CHECK (preferred_language IN ('sw','en'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- full_name — individual: their legal name. business: contact person's name.
-- Defaults to empty for backfill (legacy buyer rows did not capture this).
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';

-- -----------------------------------------------------------------------------
-- national_id_number — individual only; NULL when business.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS national_id_number text;

-- -----------------------------------------------------------------------------
-- tax_id — business: company TIN. individual: optional personal TIN.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS tax_id text;

-- -----------------------------------------------------------------------------
-- business_registration_number — business only. NULL when individual.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS business_registration_number text;

-- -----------------------------------------------------------------------------
-- kyc_status — lifecycle: not_started | in_progress | partial | verified | rejected
-- The pre-existing `kyc_status` column (production-sales.schema.ts) already
-- defaults to 'pending'; the new CHECK constraint widens the allowed set to
-- include the self-signup atom states without breaking legacy rows.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'buyers_kyc_status_signup_chk'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_kyc_status_signup_chk
      CHECK (
        kyc_status IN (
          'pending',
          'not_started',
          'in_progress',
          'partial',
          'verified',
          'rejected',
          'in_review'
        )
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- kyc_atoms_completed — JSONB array of atom-type strings already cleared.
-- Defaults to []. The compliance plugin can read this without disturbing the
-- legacy `attributes` blob.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS kyc_atoms_completed jsonb NOT NULL DEFAULT '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- wallet_balance_minor — informational only (preferred_currency minor units).
-- Authoritative money lives in payments-ledger; this column lets the buyer
-- mobile app render an at-a-glance balance without round-tripping the ledger.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS wallet_balance_minor bigint NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- bid_limit_minor — max bid amount per KYC tier (minor units of
-- preferred_currency). Enforced at the bid-placement boundary.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS bid_limit_minor bigint NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- Indexes — hot paths for the buyer mobile + admin console.
--   (account_kind, kyc_status) supports both:
--     - mobile  : "show me my KYC progress"
--     - admin   : "list businesses pending verification"
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_buyers_account_kind_kyc_status
  ON buyers (account_kind, kyc_status);

-- -----------------------------------------------------------------------------
-- RLS — buyers already has RLS enabled by the canonical mining migration.
-- Re-assert FORCE here (idempotent) so this migration documents the invariant
-- even when run against a fresh database that recreated the table.
-- -----------------------------------------------------------------------------
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyers FORCE ROW LEVEL SECURITY;

COMMIT;
