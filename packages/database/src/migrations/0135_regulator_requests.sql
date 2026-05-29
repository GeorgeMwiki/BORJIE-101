-- =============================================================================
-- Migration 0135 — regulator_requests
--
-- Closes the regulator data-subject request (DSR) chain (C-A from issue
-- #194). One row per regulator-originated request — typically a PDPC
-- subject-access request, but also NEMC inspection demands, EITI
-- contribution requests, and TMAA audit requisitions.
--
-- Companion to:
--   - services/api-gateway/src/routes/regulator/requests.hono.ts
--   - services/api-gateway/src/services/regulator/request-service.ts
--   - packages/database/src/schemas/regulator-requests.schema.ts
--   - apps/admin-web/src/app/(routes)/regulator/requests/page.tsx
--   - apps/owner-web/src/app/(routes)/compliance/...
--
-- State machine (SAP S/4HANA-style — see Docs/RESEARCH/REGULATOR_SOTA_2026-05-29.md §5):
--
--   received                — admin captured email; awaiting parse
--   parsed                  — required fields extracted; awaiting owner
--   owner_review            — pulsing on owner cockpit
--   disclosure_approved     — owner ticked the scope they release
--   exporting               — worker assembling redacted PDF + audit
--   exported                — redacted_doc_url + signed URL ready
--   delivered               — regulator confirmed receipt (or 7d auto)
--   rejected                — owner rejected disclosure
--   expired                 — SLA breach (PDPC 30d default)
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS FORCE-enabled per CLAUDE.md hard rule. Forward-only.
-- IMMUTABLE: do not edit after merge; append a new file.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS regulator_requests (
  id                  text         PRIMARY KEY,
  tenant_id           text         NOT NULL,
  /** pccb | nemc | eiti | tmaa | other. */
  regulator           text         NOT NULL,
  /**
   * Reference no. assigned by the regulator (PDPC complaint #, NEMC
   * inspection #, etc.) — optional on receipt; required before
   * `delivered`.
   */
  regulator_ref       text,
  /**
   * worker | site | licence | tenant | company | shipment — the kind
   * of subject the request is about. Drives which redactor runs.
   */
  subject_kind        text         NOT NULL,
  /**
   * Free-form subject identifier — usually a row id from the
   * matching table (`workers.id`, `sites.id`, etc.).
   */
  subject_ref         text         NOT NULL,
  /** received | parsed | owner_review | disclosure_approved |
   *  exporting | exported | delivered | rejected | expired. */
  status              text         NOT NULL DEFAULT 'received',
  /** Sw/en summary written by admin operator at intake. */
  summary_sw          text,
  summary_en          text,
  /** Scope JSON — keys the owner ticked at disclosure approval. */
  approved_scope      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  /** Free-form regulator ask body (verbatim email body). */
  raw_request         text,
  /** Signed URL for the redacted artifact (12h TTL — caller may refresh). */
  response_doc_url    text,
  /** Object-store key (bucket-relative) once the worker uploads. */
  response_doc_key    text,
  /** SHA-256 hex of the exported PDF — anchors the audit chain. */
  response_doc_sha256 text,
  /** ai_audit_chain.sequenceNumber — for tamper-evident lineage. */
  audit_chain_seq     bigint,
  requested_at        timestamptz  NOT NULL DEFAULT now(),
  /** SLA — default 30d for PDPC; 14d for NEMC; 60d for TMAA. */
  due_at              timestamptz  NOT NULL,
  owner_reviewed_at   timestamptz,
  owner_reviewed_by   text,
  exported_at         timestamptz,
  delivered_at        timestamptz,
  rejected_at         timestamptz,
  rejection_reason    text,
  created_by          text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_requests_regulator_chk'
  ) THEN
    ALTER TABLE regulator_requests
      ADD CONSTRAINT regulator_requests_regulator_chk
      CHECK (regulator IN ('pccb', 'nemc', 'eiti', 'tmaa', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_requests_subject_kind_chk'
  ) THEN
    ALTER TABLE regulator_requests
      ADD CONSTRAINT regulator_requests_subject_kind_chk
      CHECK (subject_kind IN (
        'worker', 'site', 'licence', 'tenant', 'company', 'shipment'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_requests_status_chk'
  ) THEN
    ALTER TABLE regulator_requests
      ADD CONSTRAINT regulator_requests_status_chk
      CHECK (status IN (
        'received', 'parsed', 'owner_review', 'disclosure_approved',
        'exporting', 'exported', 'delivered', 'rejected', 'expired'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS regulator_requests_tenant_idx
  ON regulator_requests (tenant_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS regulator_requests_status_idx
  ON regulator_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS regulator_requests_regulator_idx
  ON regulator_requests (tenant_id, regulator, requested_at DESC);

CREATE INDEX IF NOT EXISTS regulator_requests_due_idx
  ON regulator_requests (tenant_id, due_at);

ALTER TABLE regulator_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulator_requests FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'regulator_requests'
       AND policyname = 'regulator_requests_tenant_isolation'
  ) THEN
    CREATE POLICY regulator_requests_tenant_isolation
      ON regulator_requests
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
