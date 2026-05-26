-- =============================================================================
-- 0017: Cases SLA columns + damage-deduction + sublease tables
-- =============================================================================
-- Adds:
--   cases.sla_hours                       - SLA target per case (hours)
--   cases.sla_breached_at                 - when the SLA worker declared a breach
--   damage_deduction_cases                - damage-deduction negotiation state
--   sublease_requests                     - sublease request workflow
--   tenant_groups                         - primary/subtenant/co-tenant membership
--
-- All additive — no destructive changes.
-- Spec refs:
--   Docs/analysis/SCAFFOLDED_COMPLETION.md §3
--   Docs/analysis/MISSING_FEATURES_DESIGN.md §7, §8
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cases SLA columns
-- ----------------------------------------------------------------------------
ALTER TABLE cases ADD COLUMN IF NOT EXISTS sla_hours INTEGER;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS cases_sla_breached_at_idx ON cases (sla_breached_at);

-- ----------------------------------------------------------------------------
-- 2. Damage deduction cases
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS damage_deduction_cases (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lease_id                    TEXT REFERENCES leases(id) ON DELETE SET NULL,
  case_id                     TEXT REFERENCES cases(id)  ON DELETE SET NULL,
  move_out_inspection_id      TEXT,

  claimed_deduction_minor     INTEGER NOT NULL DEFAULT 0,
  proposed_deduction_minor    INTEGER,
  tenant_counter_proposal_minor INTEGER,
  currency                    TEXT NOT NULL DEFAULT 'TZS',

  status                      TEXT NOT NULL DEFAULT 'claim_filed',
    -- claim_filed | tenant_responded | negotiating | agreed | escalated | resolved

  evidence_bundle_id          TEXT,
  ai_mediator_turns           JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_by                  TEXT
);

CREATE INDEX IF NOT EXISTS damage_deduction_cases_tenant_idx ON damage_deduction_cases (tenant_id);
CREATE INDEX IF NOT EXISTS damage_deduction_cases_lease_idx  ON damage_deduction_cases (lease_id);
CREATE INDEX IF NOT EXISTS damage_deduction_cases_case_idx   ON damage_deduction_cases (case_id);
CREATE INDEX IF NOT EXISTS damage_deduction_cases_status_idx ON damage_deduction_cases (status);

-- ----------------------------------------------------------------------------
-- 3. Sublease requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sublease_requests (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_lease_id          TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  requested_by             TEXT NOT NULL REFERENCES customers(id),
  subtenant_candidate_id   TEXT REFERENCES customers(id),
  reason                   TEXT,
  start_date               TIMESTAMPTZ,
  end_date                 TIMESTAMPTZ,

  rent_responsibility      TEXT NOT NULL DEFAULT 'primary_tenant',
    -- primary_tenant | subtenant | split

  split_percent            JSONB,
  status                   TEXT NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected | revoked

  approval_request_id      TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               TEXT,
  updated_by               TEXT
);

CREATE INDEX IF NOT EXISTS sublease_requests_tenant_idx      ON sublease_requests (tenant_id);
CREATE INDEX IF NOT EXISTS sublease_requests_parent_idx      ON sublease_requests (parent_lease_id);
CREATE INDEX IF NOT EXISTS sublease_requests_requested_by_idx ON sublease_requests (requested_by);
CREATE INDEX IF NOT EXISTS sublease_requests_status_idx      ON sublease_requests (status);

-- ----------------------------------------------------------------------------
-- 4. Tenant groups (primary + subtenants + co-tenants)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_groups (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_lease_id  TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  members           JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ customerId: string, role: 'primary'|'subtenant'|'co_tenant' }]

  effective_from    TIMESTAMPTZ,
  effective_to      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_by        TEXT
);

CREATE INDEX IF NOT EXISTS tenant_groups_tenant_idx ON tenant_groups (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_groups_primary_lease_idx ON tenant_groups (primary_lease_id);

-- End of 0017
