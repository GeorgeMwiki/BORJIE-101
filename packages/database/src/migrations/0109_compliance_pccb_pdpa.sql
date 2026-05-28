-- =============================================================================
-- Migration 0109 — Compliance: PCCB + PDPA (Wave BRAIN-DEPTH)
--
-- Companion to:
--   - services/api-gateway/src/services/domain-depth/resolvers/pccb-resolver.ts
--   - services/api-gateway/src/services/domain-depth/resolvers/pdpa-resolver.ts
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Three new tables back the compliance sub-area resolvers
-- `anti_corruption` (PCCB) and `data_protection` (PDPA — Tanzania
-- Personal Data Protection Act 2022). They replace the
-- "awaiting data source" stubs in
-- `services/api-gateway/src/services/domain-depth/index.ts`:
--
--   1. pccb_disclosures        — gifts / hospitality / lobbying /
--      conflict-of-interest declarations the MD or directors file under
--      PCCA 2007. Anti-bribery audit-grade ledger; rolled up for the
--      compliance dashboard's anti-corruption tile.
--
--   2. pdpa_processing_records — Article 30-style processing register
--      every controller must maintain under PDPA 2022. One row per
--      processing activity with lawful basis, retention, DPIA pointer.
--
--   3. pdpa_subject_requests   — data-subject rights inbox (access /
--      rectify / erase / portability / objection). 30-day statutory
--      response window; the resolver surfaces overdue requests so the
--      MD acts before the regulator does.
--
-- All three tables are tenant-scoped via the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS predicate. RLS is
-- FORCE-enabled per the Borjie hard rule (CLAUDE.md).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) pccb_disclosures — anti-corruption disclosure ledger.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pccb_disclosures (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text         NOT NULL,
  /** Internal id of the person filing the disclosure (MD / director /
   *  senior manager). FK is logical — we keep the persons schema light
   *  to avoid migration coupling. */
  declarant_id       text         NOT NULL,
  /** Kind of disclosure. */
  kind               text         NOT NULL,
  /** Monetary value of the gift / hospitality in TZS. NULL when the
   *  disclosure is non-monetary (e.g. a conflict of interest). */
  value_tzs          bigint,
  /** External counterparty if applicable (a supplier, a regulator). */
  recipient_party_id text,
  declared_at        timestamptz  NOT NULL DEFAULT now(),
  /** Reporting period the disclosure covers — month-precision is enough
   *  for the annual PCCB summary. */
  period_covered     date         NOT NULL,
  /** Pointer to an uploaded receipt or signed declaration. */
  evidence_doc_id    text,
  /** Audit-trace bag — actor, ip, ua, brain confidence, hash chain ref. */
  provenance         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pccb_disclosures_kind_chk'
  ) THEN
    ALTER TABLE pccb_disclosures
      ADD CONSTRAINT pccb_disclosures_kind_chk
      CHECK (kind IN ('gift', 'hospitality', 'lobbying', 'conflict_of_interest'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pccb_disclosures_tenant_filed
  ON pccb_disclosures (tenant_id, declared_at DESC);

CREATE INDEX IF NOT EXISTS idx_pccb_disclosures_tenant_period
  ON pccb_disclosures (tenant_id, period_covered);

ALTER TABLE pccb_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pccb_disclosures FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pccb_disclosures'
       AND policyname = 'pccb_disclosures_tenant_isolation'
  ) THEN
    CREATE POLICY pccb_disclosures_tenant_isolation
      ON pccb_disclosures
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) pdpa_processing_records — Article 30-style processing register.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pdpa_processing_records (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text         NOT NULL,
  /** Free-form: employees / buyers / suppliers / community_members. */
  data_subject_kind           text         NOT NULL,
  /** Categories of personal data processed (jsonb array). */
  data_categories             jsonb        NOT NULL,
  /** PDPA lawful basis — consent / contract / legal_obligation /
   *  vital_interest / public_interest / legitimate_interest. */
  lawful_basis                text         NOT NULL,
  /** ISO 8601 duration; e.g. P5Y for five years. */
  retention_period            text         NOT NULL,
  /** Internal id of the controller / DPO. */
  controller_id               text         NOT NULL,
  /** Third-party processor if any. */
  processor_party_id          text,
  /** Pointer to the DPIA document if a high-risk processing. */
  dpia_doc_id                 text,
  /** Lifecycle of the most recent breach: none | open | notified | closed. */
  breach_notification_state   text         NOT NULL DEFAULT 'none',
  last_review_at              timestamptz,
  provenance                  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdpa_processing_records_basis_chk'
  ) THEN
    ALTER TABLE pdpa_processing_records
      ADD CONSTRAINT pdpa_processing_records_basis_chk
      CHECK (lawful_basis IN (
        'consent', 'contract', 'legal_obligation',
        'vital_interest', 'public_interest', 'legitimate_interest'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdpa_processing_records_breach_chk'
  ) THEN
    ALTER TABLE pdpa_processing_records
      ADD CONSTRAINT pdpa_processing_records_breach_chk
      CHECK (breach_notification_state IN ('none', 'open', 'notified', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pdpa_processing_records_tenant_review
  ON pdpa_processing_records (tenant_id, last_review_at);

ALTER TABLE pdpa_processing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdpa_processing_records FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pdpa_processing_records'
       AND policyname = 'pdpa_processing_records_tenant_isolation'
  ) THEN
    CREATE POLICY pdpa_processing_records_tenant_isolation
      ON pdpa_processing_records
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) pdpa_subject_requests — data-subject rights inbox + SLA tracker.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pdpa_subject_requests (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text         NOT NULL,
  /** Email the requester used. May be NULL if request arrived via an
   *  in-app form keyed by an internal subject id. */
  requester_email   text,
  /** Kind of right exercised. */
  request_kind      text         NOT NULL,
  submitted_at      timestamptz  NOT NULL DEFAULT now(),
  /** PDPA 2022 default response window is 30 days from receipt. */
  due_by            timestamptz  NOT NULL,
  responded_at      timestamptz,
  /** Pointer to the response document delivered to the requester. */
  response_doc_id   text,
  /** Lifecycle: open → in_review → responded | rejected | escalated. */
  status            text         NOT NULL DEFAULT 'open',
  provenance        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdpa_subject_requests_kind_chk'
  ) THEN
    ALTER TABLE pdpa_subject_requests
      ADD CONSTRAINT pdpa_subject_requests_kind_chk
      CHECK (request_kind IN ('access', 'rectify', 'erase', 'portability', 'objection'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdpa_subject_requests_status_chk'
  ) THEN
    ALTER TABLE pdpa_subject_requests
      ADD CONSTRAINT pdpa_subject_requests_status_chk
      CHECK (status IN ('open', 'in_review', 'responded', 'rejected', 'escalated'));
  END IF;
END $$;

-- Hot path: open requests ordered by due-date for the SLA panel.
CREATE INDEX IF NOT EXISTS idx_pdpa_subject_requests_tenant_due
  ON pdpa_subject_requests (tenant_id, due_by)
  WHERE status IN ('open', 'in_review');

CREATE INDEX IF NOT EXISTS idx_pdpa_subject_requests_tenant_status
  ON pdpa_subject_requests (tenant_id, status, submitted_at DESC);

ALTER TABLE pdpa_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdpa_subject_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pdpa_subject_requests'
       AND policyname = 'pdpa_subject_requests_tenant_isolation'
  ) THEN
    CREATE POLICY pdpa_subject_requests_tenant_isolation
      ON pdpa_subject_requests
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
