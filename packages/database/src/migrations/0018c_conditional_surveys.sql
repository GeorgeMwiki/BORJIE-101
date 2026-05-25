-- ============================================================================
-- BORJIE — Conditional Surveys (NEW 2)
--
-- Scheduled property surveys that produce findings and an action plan.
-- ============================================================================

-- Enums ----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE conditional_survey_status AS ENUM (
    'draft', 'scheduled', 'in_progress', 'compiled', 'approved', 'archived', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conditional_survey_severity AS ENUM (
    'low', 'medium', 'high', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conditional_survey_action_status AS ENUM (
    'proposed', 'approved', 'in_progress', 'completed', 'deferred', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- conditional_surveys --------------------------------------------------------

CREATE TABLE IF NOT EXISTS conditional_surveys (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id           TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id               TEXT REFERENCES units(id) ON DELETE SET NULL,
  source_inspection_id  TEXT REFERENCES inspections(id) ON DELETE SET NULL,
  surveyor_id           TEXT REFERENCES users(id) ON DELETE SET NULL,

  status                conditional_survey_status NOT NULL DEFAULT 'draft',
  scheduled_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  compiled_at           TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,

  narrative             TEXT,
  summary               JSONB DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT,
  updated_by            TEXT
);

CREATE INDEX IF NOT EXISTS conditional_surveys_tenant_idx       ON conditional_surveys(tenant_id);
CREATE INDEX IF NOT EXISTS conditional_surveys_property_idx     ON conditional_surveys(property_id);
CREATE INDEX IF NOT EXISTS conditional_surveys_unit_idx         ON conditional_surveys(unit_id);
CREATE INDEX IF NOT EXISTS conditional_surveys_status_idx       ON conditional_surveys(status);
CREATE INDEX IF NOT EXISTS conditional_surveys_scheduled_at_idx ON conditional_surveys(scheduled_at);

-- conditional_survey_findings ------------------------------------------------

CREATE TABLE IF NOT EXISTS conditional_survey_findings (
  id            TEXT PRIMARY KEY,
  survey_id     TEXT NOT NULL REFERENCES conditional_surveys(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  area          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  severity      conditional_survey_severity NOT NULL DEFAULT 'low',

  photos        JSONB DEFAULT '[]'::jsonb,
  attachments   JSONB DEFAULT '[]'::jsonb,
  metadata      JSONB DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT,
  updated_by    TEXT
);

CREATE INDEX IF NOT EXISTS conditional_survey_findings_survey_idx   ON conditional_survey_findings(survey_id);
CREATE INDEX IF NOT EXISTS conditional_survey_findings_tenant_idx   ON conditional_survey_findings(tenant_id);
CREATE INDEX IF NOT EXISTS conditional_survey_findings_severity_idx ON conditional_survey_findings(severity);

-- conditional_survey_action_plans --------------------------------------------

CREATE TABLE IF NOT EXISTS conditional_survey_action_plans (
  id                  TEXT PRIMARY KEY,
  survey_id           TEXT NOT NULL REFERENCES conditional_surveys(id) ON DELETE CASCADE,
  finding_id          TEXT REFERENCES conditional_survey_findings(id) ON DELETE SET NULL,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  title               TEXT NOT NULL,
  description         TEXT,
  priority            INTEGER NOT NULL DEFAULT 3,
  status              conditional_survey_action_status NOT NULL DEFAULT 'proposed',

  estimated_cost_cents INTEGER,
  currency             TEXT DEFAULT 'KES',
  target_date          TIMESTAMPTZ,

  approved_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT,
  updated_by           TEXT
);

CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_survey_idx  ON conditional_survey_action_plans(survey_id);
CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_finding_idx ON conditional_survey_action_plans(finding_id);
CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_tenant_idx  ON conditional_survey_action_plans(tenant_id);
CREATE INDEX IF NOT EXISTS conditional_survey_action_plans_status_idx  ON conditional_survey_action_plans(status);

-- Row-level security ---------------------------------------------------------

ALTER TABLE conditional_surveys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditional_survey_findings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditional_survey_action_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY conditional_surveys_tenant_isolation ON conditional_surveys
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conditional_survey_findings_tenant_isolation ON conditional_survey_findings
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conditional_survey_action_plans_tenant_isolation ON conditional_survey_action_plans
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
