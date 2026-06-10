-- =============================================================================
-- Migration 0335 — operator-vs-customer `tenant_type` discriminator.
--
-- WHY THIS MIGRATION EXISTS (operator-ERP layer / self-hosting fractal)
-- --------------------------------------------------------------------
-- The operator (Borjie-the-company) is a FIRST-CLASS TENANT of its own platform
-- that runs on Mr-Mwikila + the UNIVERSAL business pack (ERP: GL/AP/AR/payroll/
-- CRM/procurement/treasury/FP&A) over its OWN books — NOT a back door.
-- `account_kind` (individual|business) is the self-signup KYC axis and the WRONG
-- slot for this, so we add an ORTHOGONAL `tenant_type`:
--   - 'customer' (default): a tenant that buys Borjie; runs its estate on a
--                customer-vertical pack (mining-tz, …). Every legacy row is one.
--   - 'operator': the platform operator's own tenant; loads the business pack.
--
-- The cortex, the `app.current_tenant_id` RLS GUC, and the LedgerService.post()
-- money path are IDENTICAL for both — only the loaded domain pack + the primary
-- surface (admin-web for the operator) differ. PARITY / zero back-doors.
--
-- IDEMPOTENCY (CLAUDE.md hard rule)
-- --------------------------------
-- ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, guarded by a
-- to_regclass existence check so a fresh lex-order apply never errors and a
-- re-run is a pure no-op. The column is NOT NULL DEFAULT 'customer' — a CONSTANT
-- default, so Postgres fills existing rows in a single metadata-only operation
-- (no table rewrite, no backfill hazard). Values are validated at the app layer
-- (zod) per the repo convention (no pg_enum, keeping the chain forward-only).
--
-- Companion: down/0335_down_operator_tenant_type.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    ALTER TABLE public.tenants
      ADD COLUMN IF NOT EXISTS tenant_type text NOT NULL DEFAULT 'customer';

    CREATE INDEX IF NOT EXISTS tenants_tenant_type_idx
      ON public.tenants (tenant_type);
  END IF;
END $$;

COMMIT;
