-- =============================================================================
-- Migration 0102 — Workforce Certifications + Cert-Expiry Reminder Dedup
--
-- Companion to:
--   - services/api-gateway/src/workers/ica-cert-expiry-cron.ts
--   - packages/database/src/schemas/workforce-certifications.schema.ts
--
-- Two tables:
--
--   1. workforce_certifications — per-employee mining certifications
--      (ICA, blasting licence, first-aid, machinery operator, etc.)
--      with an `expires_at` deadline. The cron scans for any active
--      cert expiring within 30 days and auto-creates reminders.
--
--   2. workforce_cert_expiry_reminders — dedup ledger keyed on
--      (tenant_id, cert_id, days_before) so the cron is idempotent
--      across restarts.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workforce_certifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  /** FK-ish reference to users.id — soft to avoid breaking the soft
   *  delete pattern on users. */
  user_id              text        NOT NULL,
  /** Certification code, e.g. ICA-BLASTING-A, FIRSTAID-L3, MACHINERY-OP-EX. */
  cert_code            text        NOT NULL,
  cert_name            text        NOT NULL,
  issued_at            timestamptz NOT NULL,
  expires_at           timestamptz NOT NULL,
  /** Issuing body, e.g. TBS, NEMC, TUMEMADINI. */
  issuer               text        NOT NULL,
  /** Status: active | expired | suspended | revoked. */
  status               text        NOT NULL DEFAULT 'active',
  /** URL to the scan or licence document in storage. */
  document_url         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_certifications_status_chk
    CHECK (status IN ('active', 'expired', 'suspended', 'revoked'))
);

CREATE INDEX IF NOT EXISTS workforce_certifications_tenant_user_idx
  ON workforce_certifications (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS workforce_certifications_tenant_expiry_idx
  ON workforce_certifications (tenant_id, expires_at)
  WHERE status = 'active';

ALTER TABLE workforce_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_certifications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_certifications'
       AND policyname = 'workforce_certifications_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_certifications_tenant_isolation
      ON workforce_certifications
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Dedup ledger for the cert-expiry cron.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_cert_expiry_reminders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  cert_id              uuid        NOT NULL,
  days_before          integer     NOT NULL,
  /** FK to the reminders row the cron created. */
  reminder_id          uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workforce_cert_expiry_reminders_uniq
  ON workforce_cert_expiry_reminders (tenant_id, cert_id, days_before);

CREATE INDEX IF NOT EXISTS workforce_cert_expiry_reminders_tenant_idx
  ON workforce_cert_expiry_reminders (tenant_id, created_at DESC);

ALTER TABLE workforce_cert_expiry_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_cert_expiry_reminders FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_cert_expiry_reminders'
       AND policyname = 'workforce_cert_expiry_reminders_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_cert_expiry_reminders_tenant_isolation
      ON workforce_cert_expiry_reminders
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
