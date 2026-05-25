-- =============================================================================
-- 0109: Legal drafts (Agent PhL — LLM-composed notices, addenda, demand letters)
-- =============================================================================
-- First-draft documents composed by an LLM using jurisdiction-specific
-- statutory requirements (LeaseLawPort.leaseLaw()). Every draft is queued
-- for HUMAN review by default — the only path to auto-send is when the
-- tenant's autonomy policy explicitly enables it for that document kind,
-- subject to the non-negotiable compliance invariant: eviction-notice drafts
-- are NEVER auto-sendable regardless of policy.
--
-- Citation discipline: `legal_citations` lists the statute refs the LLM
-- relied on (pulled from LeaseLawPort.citations) — every clause can point
-- to the law it's satisfying.
--
-- `needs_human_review` is TRUE by default and set to FALSE only when the
-- autonomy policy explicitly permits auto-send AND the document kind is not
-- on the forbidden-auto-send list.
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_drafts (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_kind             TEXT NOT NULL CHECK (
                              document_kind IN (
                                'notice_to_vacate',
                                'lease_addendum',
                                'demand_letter',
                                'eviction_notice',
                                'renewal_offer',
                                'rent_increase_notice',
                                'cure_or_quit',
                                'move_out_statement',
                                'other'
                              )
                            ),
  country_code              TEXT NOT NULL,                       -- ISO-3166-1 alpha-2
  jurisdiction_metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- state, locality, subdivision
  subject_customer_id       TEXT,
  subject_lease_id          TEXT,
  subject_property_id       TEXT,
  subject_unit_id           TEXT,
  language_code             TEXT,                                -- ISO-639-1/-2
  draft_title               TEXT NOT NULL,
  draft_body                TEXT NOT NULL,                       -- final rendered text
  required_clauses          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- clauses from jurisdiction
  legal_citations           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- statute refs / URLs
  review_flags              JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ambiguity, missing-facts flags
  needs_human_review        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Compliance invariant: eviction notices MUST require human review.
  CONSTRAINT legal_drafts_eviction_must_review CHECK (
    document_kind <> 'eviction_notice' OR needs_human_review = TRUE
  ),
  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (
                              status IN ('draft', 'reviewed', 'approved', 'rejected', 'sent', 'superseded')
                            ),
  autonomy_decision         TEXT NOT NULL CHECK (
                              autonomy_decision IN ('queued_for_review', 'auto_send_allowed', 'auto_send_forbidden')
                            ),
  model_version             TEXT NOT NULL,
  prompt_hash               TEXT NOT NULL,
  confidence                DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  context                   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- facts the LLM was given
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_drafts_tenant_status
  ON legal_drafts (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_drafts_kind
  ON legal_drafts (tenant_id, document_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_drafts_review_queue
  ON legal_drafts (tenant_id, needs_human_review, status)
  WHERE needs_human_review = TRUE AND status = 'draft';
