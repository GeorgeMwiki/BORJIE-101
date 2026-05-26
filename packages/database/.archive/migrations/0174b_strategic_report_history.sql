-- ============================================================================
-- Migration 0174 — Strategic report history (P18 — PhD-grade report engine).
--
-- Background:
--   The `@borjie/strategic-reports` engine produces 10 typed report
--   families (leasing financial / conditional survey / acquisition IC /
--   disposition / refinancing / sustainability / expansion / tenant
--   credit / rent-roll / annual operating review). The api-gateway
--   `/v1/strategic-reports` routes need a tenant-scoped log of every
--   render so:
--
--     1. Users can list past reports for their org + report kind
--        (filterable by `since` / `until`)
--     2. The regenerate path can re-run with the original spec without
--        re-typing the deal/property/portfolio scope
--     3. The WORM audit chain has a foreign-key anchor for every
--        rendered artifact (`audit_chain_id` references the
--        `worm_audit_log` entry id minted in 0165)
--
-- This table is APPEND-MOSTLY in practice. We surface `status` so the
-- worker can transition `queued → rendering → completed | failed`,
-- and we keep failed rows for triage rather than deleting them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategic_report_history (
  report_id        TEXT PRIMARY KEY,
  -- Tenant + org are the multi-tenancy anchors. Tenant is the SaaS
  -- customer; org is the same value today but kept distinct in case
  -- a future cross-org sub-tenant model splits them.
  tenant_id        TEXT NOT NULL,
  org_id           TEXT NOT NULL,
  /**
   * One of the ReportType enum values:
   *   leasing_financial_performance | conditional_survey_of_assets |
   *   acquisition_deal_ic_memo | disposition_memo_asset_profile |
   *   refinancing_strategy_memo | sustainability_ghg_report |
   *   expansion_strategy_memo | tenant_credit_risk_profile |
   *   rent_roll_arrears_ledger | annual_estate_operating_review
   */
  spec_kind        TEXT NOT NULL,
  /** The full ReportSpec — JSONB so regenerate can replay it byte-for-byte. */
  spec             JSONB NOT NULL,
  /**
   * Job status:
   *   queued     — accepted by the API, sitting in the worker queue
   *   rendering  — the renderer picked it up; still mid-pipeline
   *   completed  — artifact persisted, audit chain entry signed
   *   failed     — pipeline returned an error; `metadata.errorCode`
   *                carries the typed code
   */
  status           TEXT NOT NULL,
  /** When the report was actually generated (null while queued/rendering). */
  generated_at     TIMESTAMPTZ,
  /** Where the rendered artifact lives (S3 URI, Supabase storage path, …). */
  storage_uri      TEXT,
  /** SHA-256 of the rendered artifact bytes for tamper-detection. */
  hash_sha256      TEXT,
  /** FK-style anchor into `worm_audit_log` (0165) — not a hard FK so the
   *  audit log can be archived / shipped to cold storage without breaking
   *  this history row. */
  audit_chain_id   TEXT,
  /**
   * Free-form: { warnings, errorCode, durationMs, synthesis: { agreement, ... } }
   * Used by the operator dashboards + the regenerate UI.
   */
  metadata         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT strategic_report_history_status_chk
    CHECK (status IN ('queued', 'rendering', 'completed', 'failed'))
);

-- Hot path: list past reports for an org filtered by kind + sorted
-- by created_at desc (latest first). Used by GET /v1/strategic-reports.
CREATE INDEX IF NOT EXISTS strategic_report_history_tenant_kind_idx
  ON strategic_report_history (tenant_id, spec_kind, created_at DESC);

-- Org-wide list (all kinds, latest first). Used by the operator
-- audit dashboard.
CREATE INDEX IF NOT EXISTS strategic_report_history_org_idx
  ON strategic_report_history (org_id, created_at DESC);

-- Status filter — the worker polls `status = 'queued'`.
CREATE INDEX IF NOT EXISTS strategic_report_history_status_idx
  ON strategic_report_history (status)
  WHERE status IN ('queued', 'rendering');
