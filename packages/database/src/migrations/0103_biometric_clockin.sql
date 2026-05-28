-- =============================================================================
-- Migration 0103 - Biometric clock-in / clock-out events.
--
-- Wave WORKFORCE-CLOCK-IN. Records each shift's clock-in / clock-out
-- with biometric provider attestation and geo fix. Powers the workforce
-- mobile app (`expo-local-authentication`) and the owner-web WebAuthn
-- kiosk. Also exposed to the chat-as-OS brain via the tools
-- `workforce.clock_in_query` and `workforce.attendance_status` so the
-- LLM and the explicit Workforce tab read identical data.
--
-- Tables:
--   * clock_in_events  - one row per (employee, clock-in instant) with
--                        biometric provider, pass flag, geo + device.
--
-- Tenant scope:
--   tenant_id::text = current_setting('app.current_tenant_id', true)
--
-- RLS FORCE-enabled per CLAUDE.md. Idempotent (IF NOT EXISTS + DO
-- blocks). Forward-only - never edit.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS clock_in_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  employee_id          uuid        NOT NULL,
  site_id              uuid        NOT NULL,
  clocked_in_at        timestamptz NOT NULL DEFAULT now(),
  clocked_out_at       timestamptz,
  biometric_provider   text        NOT NULL,
  biometric_passed     boolean     NOT NULL,
  device_id            text,
  geo_lat              numeric(10, 7),
  geo_lng              numeric(10, 7),
  provenance           jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'clock_in_events_provider_chk'
  ) THEN
    ALTER TABLE clock_in_events
      ADD CONSTRAINT clock_in_events_provider_chk
      CHECK (biometric_provider IN (
        'expo_local_auth', 'webauthn_platform', 'webauthn_cross_platform',
        'fingerprint_device', 'face_id', 'touch_id', 'pin_fallback', 'manual_supervisor'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'clock_in_events_close_chk'
  ) THEN
    ALTER TABLE clock_in_events
      ADD CONSTRAINT clock_in_events_close_chk
      CHECK (clocked_out_at IS NULL OR clocked_out_at >= clocked_in_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clock_in_events_tenant_employee
  ON clock_in_events (tenant_id, employee_id, clocked_in_at DESC);

CREATE INDEX IF NOT EXISTS clock_in_events_tenant_site_day
  ON clock_in_events (tenant_id, site_id, clocked_in_at DESC);

ALTER TABLE clock_in_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_in_events FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'clock_in_events'
       AND policyname = 'clock_in_events_tenant_isolation'
  ) THEN
    CREATE POLICY clock_in_events_tenant_isolation
      ON clock_in_events
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
