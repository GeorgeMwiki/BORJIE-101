-- =============================================================================
-- Migration 0053 — Data Protection (SEC-3, Mr. Mwikila)
--
-- Spec: Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md
--      Docs/COMPLIANCE/DATA_RETENTION_POLICY.md
--
-- Adds six tenant-scoped tables that underpin the SOTA data-protection
-- posture for Borjie:
--
--   1. data_classifications  — one row per (tenant, entity_kind, entity_id),
--                              carrying the 8-class lattice tag (public,
--                              internal, confidential, restricted, critical,
--                              pii, phi, financial). UNIQUE per tuple.
--                              audit_hash for tamper evidence.
--
--   2. encryption_keys       — one row per platform / customer-managed key.
--                              key_kind in (platform-managed,
--                              customer-managed-byok, customer-managed-hyok).
--                              created / rotated / retired timestamps.
--
--   3. retention_policies    — one row per (tenant, class). retention_days
--                              + exception_categories (jsonb array of
--                              category strings, e.g. 'litigation_hold').
--                              UNIQUE per (tenant, class).
--
--   4. rtbf_requests         — right-to-be-forgotten requests. status in
--                              (open, in-progress, completed, denied,
--                              expired). prev_hash + audit_hash for the
--                              tamper-evident chain.
--
--   5. rtbf_cascades         — per-target-table cascade actions for an
--                              RTBF request. action in (redacted, deleted,
--                              crypto-shredded, retained-legal-hold).
--
--   6. breach_events         — breach detection + 72-hour notification
--                              timeline. affected_classes[] text array;
--                              notified_authority_at and
--                              notified_subjects_at timestamps. prev_hash
--                              + audit_hash for the chain.
--
-- All six are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern (see migration
-- 0003). Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. data_classifications — eight-class lattice tag per entity
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS data_classifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  entity_kind       text NOT NULL,
  entity_id         text NOT NULL,
  /** One of: public, internal, confidential, restricted, critical, pii, phi, financial. */
  class             text NOT NULL,
  labelled_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT data_classifications_unique UNIQUE (tenant_id, entity_kind, entity_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_classifications_class_chk'
  ) THEN
    ALTER TABLE data_classifications
      ADD CONSTRAINT data_classifications_class_chk
      CHECK (class IN (
        'public', 'internal', 'confidential', 'restricted',
        'critical', 'pii', 'phi', 'financial'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_data_classifications_tenant_kind
  ON data_classifications (tenant_id, entity_kind, labelled_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_classifications_class
  ON data_classifications (tenant_id, class, labelled_at DESC);

ALTER TABLE data_classifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_classifications_tenant_read ON data_classifications;
CREATE POLICY data_classifications_tenant_read ON data_classifications
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE data_classifications IS
  'SEC-3 (Mr. Mwikila) — per-entity classification tag from the 8-class lattice. UNIQUE(tenant, entity_kind, entity_id). See Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md §1.';

-- -----------------------------------------------------------------------------
-- 2. encryption_keys — platform-managed / BYOK / HYOK key records
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS encryption_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  /** platform-managed | customer-managed-byok | customer-managed-hyok */
  key_kind          text NOT NULL,
  /** Opaque key reference (ARN, KMS resource id, external alias). NEVER raw key material. */
  key_ref           text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  rotated_at        timestamptz,
  retired_at        timestamptz,
  audit_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'encryption_keys_kind_chk'
  ) THEN
    ALTER TABLE encryption_keys
      ADD CONSTRAINT encryption_keys_kind_chk
      CHECK (key_kind IN (
        'platform-managed', 'customer-managed-byok', 'customer-managed-hyok'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_encryption_keys_tenant_kind
  ON encryption_keys (tenant_id, key_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_encryption_keys_active
  ON encryption_keys (tenant_id, created_at DESC)
  WHERE retired_at IS NULL;

ALTER TABLE encryption_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS encryption_keys_tenant_read ON encryption_keys;
CREATE POLICY encryption_keys_tenant_read ON encryption_keys
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE encryption_keys IS
  'SEC-3 (Mr. Mwikila) — KEK reference per tenant. key_ref is opaque (KMS ARN or alias). RAW KEY MATERIAL IS NEVER PERSISTED HERE. See Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md §4.';

-- -----------------------------------------------------------------------------
-- 3. retention_policies — per (tenant, class) retention window
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retention_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  class                 text NOT NULL,
  retention_days        integer NOT NULL,
  /** JSON array of category strings. Categories listed here are exempt from purge. */
  exception_categories  jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_purge_at         timestamptz,
  audit_hash            text NOT NULL,
  CONSTRAINT retention_policies_unique UNIQUE (tenant_id, class)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_class_chk'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_class_chk
      CHECK (class IN (
        'public', 'internal', 'confidential', 'restricted',
        'critical', 'pii', 'phi', 'financial'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_days_chk'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_days_chk
      CHECK (retention_days >= 1 AND retention_days <= 36500);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant
  ON retention_policies (tenant_id, class);

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retention_policies_tenant_read ON retention_policies;
CREATE POLICY retention_policies_tenant_read ON retention_policies
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE retention_policies IS
  'SEC-3 (Mr. Mwikila) — retention_days + exception_categories per (tenant, class). UNIQUE(tenant, class). See Docs/COMPLIANCE/DATA_RETENTION_POLICY.md.';

-- -----------------------------------------------------------------------------
-- 4. rtbf_requests — right-to-be-forgotten requests (hash-chained)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rtbf_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  subject_id        text NOT NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  /** open | in-progress | completed | denied | expired */
  status            text NOT NULL DEFAULT 'open',
  denial_reason     text,
  completed_at      timestamptz,
  prev_hash         text NOT NULL,
  audit_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rtbf_requests_status_chk'
  ) THEN
    ALTER TABLE rtbf_requests
      ADD CONSTRAINT rtbf_requests_status_chk
      CHECK (status IN (
        'open', 'in-progress', 'completed', 'denied', 'expired'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rtbf_requests_denied_chk'
  ) THEN
    ALTER TABLE rtbf_requests
      ADD CONSTRAINT rtbf_requests_denied_chk
      CHECK (
        (status = 'denied' AND denial_reason IS NOT NULL) OR
        (status <> 'denied')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rtbf_requests_completed_chk'
  ) THEN
    ALTER TABLE rtbf_requests
      ADD CONSTRAINT rtbf_requests_completed_chk
      CHECK (
        (status = 'completed' AND completed_at IS NOT NULL) OR
        (status <> 'completed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtbf_requests_tenant_status
  ON rtbf_requests (tenant_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_rtbf_requests_subject
  ON rtbf_requests (tenant_id, subject_id, requested_at DESC);

ALTER TABLE rtbf_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rtbf_requests_tenant_read ON rtbf_requests;
CREATE POLICY rtbf_requests_tenant_read ON rtbf_requests
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE rtbf_requests IS
  'SEC-3 (Mr. Mwikila) — RTBF requests (TZ DPA s. 37 / GDPR Art. 17 / CCPA § 1798.105). Hash-chained via prev_hash + audit_hash. See Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md §5.';

-- -----------------------------------------------------------------------------
-- 5. rtbf_cascades — per-target-table cascade actions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rtbf_cascades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rtbf_request_id     uuid NOT NULL REFERENCES rtbf_requests(id) ON DELETE CASCADE,
  target_table        text NOT NULL,
  target_id           text NOT NULL,
  /** redacted | deleted | crypto-shredded | retained-legal-hold */
  action              text NOT NULL,
  executed_at         timestamptz,
  audit_hash          text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rtbf_cascades_action_chk'
  ) THEN
    ALTER TABLE rtbf_cascades
      ADD CONSTRAINT rtbf_cascades_action_chk
      CHECK (action IN (
        'redacted', 'deleted', 'crypto-shredded', 'retained-legal-hold'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtbf_cascades_request
  ON rtbf_cascades (rtbf_request_id, executed_at DESC NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_rtbf_cascades_target
  ON rtbf_cascades (target_table, target_id);

ALTER TABLE rtbf_cascades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rtbf_cascades_tenant_read ON rtbf_cascades;
CREATE POLICY rtbf_cascades_tenant_read ON rtbf_cascades
  USING (
    EXISTS (
      SELECT 1 FROM rtbf_requests r
      WHERE r.id = rtbf_cascades.rtbf_request_id
        AND r.tenant_id = current_setting('app.tenant_id', true)
    )
  );

COMMENT ON TABLE rtbf_cascades IS
  'SEC-3 (Mr. Mwikila) — per-table cascade actions for an RTBF request. action in (redacted, deleted, crypto-shredded, retained-legal-hold). RLS via parent rtbf_requests.tenant_id.';

-- -----------------------------------------------------------------------------
-- 6. breach_events — detection + 72-hour notification timeline
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS breach_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL,
  detected_at              timestamptz NOT NULL DEFAULT now(),
  /** low | medium | high | critical */
  severity                 text NOT NULL,
  /** Array of classification strings (e.g. {'pii','phi'}) */
  affected_classes         text[] NOT NULL DEFAULT '{}',
  affected_count_estimate  integer NOT NULL DEFAULT 0,
  notified_authority_at    timestamptz,
  notified_subjects_at     timestamptz,
  resolution               text,
  prev_hash                text NOT NULL,
  audit_hash               text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'breach_events_severity_chk'
  ) THEN
    ALTER TABLE breach_events
      ADD CONSTRAINT breach_events_severity_chk
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'breach_events_count_chk'
  ) THEN
    ALTER TABLE breach_events
      ADD CONSTRAINT breach_events_count_chk
      CHECK (affected_count_estimate >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_breach_events_tenant
  ON breach_events (tenant_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_breach_events_severity
  ON breach_events (tenant_id, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_breach_events_unnotified
  ON breach_events (tenant_id, detected_at DESC)
  WHERE notified_authority_at IS NULL;

ALTER TABLE breach_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS breach_events_tenant_read ON breach_events;
CREATE POLICY breach_events_tenant_read ON breach_events
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE breach_events IS
  'SEC-3 (Mr. Mwikila) — breach detection + 72-hour notification timeline (TZ DPA s. 33 / GDPR Art. 33+34 / CCPA § 1798.82). affected_classes is a Postgres text array of the 8-class lattice. Hash-chained.';

COMMIT;
