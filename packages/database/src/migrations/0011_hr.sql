-- ============================================================================
-- BORJIE Brain — HR Schema (departments, teams, employees, assignments,
-- team memberships, performance records).
--
-- All tables are tenant-scoped with Row Level Security so the Brain personae
-- never read across tenant boundaries.
-- ============================================================================

-- Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE employment_status AS ENUM (
    'active', 'on_leave', 'suspended', 'terminated', 'pending_onboarding'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE employment_type AS ENUM (
    'full_time', 'part_time', 'contract', 'casual', 'intern', 'vendor'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE team_kind AS ENUM (
    'leasing', 'maintenance', 'finance', 'compliance', 'communications',
    'operations', 'security', 'caretaking', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE assignment_status AS ENUM (
    'draft', 'assigned', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE performance_kind AS ENUM (
    'observation', 'weekly_summary', 'monthly_review', 'quarterly_review',
    'peer_feedback', 'tenant_feedback', 'sla_miss', 'sla_hit', 'recognition'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Departments --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  head_employee_id  TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT,
  updated_by        TEXT,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS departments_tenant_idx ON departments(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS departments_code_tenant_idx ON departments(tenant_id, code);

-- Teams --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teams (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id            TEXT REFERENCES departments(id) ON DELETE SET NULL,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  kind                     team_kind NOT NULL,
  description              TEXT,
  junior_persona_id        TEXT,
  team_leader_employee_id  TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  settings                 JSONB DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_by               TEXT,
  deleted_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS teams_tenant_idx ON teams(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_code_tenant_idx ON teams(tenant_id, code);
CREATE INDEX IF NOT EXISTS teams_department_idx ON teams(department_id);
CREATE INDEX IF NOT EXISTS teams_kind_idx ON teams(tenant_id, kind);

-- Employees ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  employee_code         TEXT NOT NULL,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  preferred_name        TEXT,
  phone                 TEXT,
  phone_alt             TEXT,
  email                 TEXT,
  status                employment_status NOT NULL DEFAULT 'pending_onboarding',
  employment_type       employment_type NOT NULL DEFAULT 'full_time',
  job_title             TEXT NOT NULL,
  department_id         TEXT REFERENCES departments(id) ON DELETE SET NULL,
  manager_employee_id   TEXT,
  hire_date             TIMESTAMPTZ,
  termination_date      TIMESTAMPTZ,
  capabilities          JSONB DEFAULT '{}'::jsonb,
  languages             TEXT[] DEFAULT ARRAY[]::TEXT[],
  base_salary_kes       NUMERIC(14, 2),
  covered_property_ids  TEXT[] DEFAULT ARRAY[]::TEXT[],
  notes                 TEXT,
  metadata              JSONB DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT,
  updated_by            TEXT,
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS employees_tenant_idx ON employees(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS employees_code_tenant_idx ON employees(tenant_id, employee_code);
CREATE INDEX IF NOT EXISTS employees_status_idx ON employees(tenant_id, status);
CREATE INDEX IF NOT EXISTS employees_user_idx ON employees(user_id);
CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_employee_id);
CREATE INDEX IF NOT EXISTS employees_department_idx ON employees(department_id);

-- Team memberships ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_memberships (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_temporary    BOOLEAN NOT NULL DEFAULT false,
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ,
  role_label      TEXT DEFAULT 'member',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT
);
CREATE INDEX IF NOT EXISTS team_memberships_tenant_idx ON team_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS team_memberships_team_idx ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS team_memberships_employee_idx ON team_memberships(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_unique_active_idx ON team_memberships(team_id, employee_id);

-- Assignments --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assignments (
  id                         TEXT PRIMARY KEY,
  tenant_id                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id                    TEXT REFERENCES teams(id) ON DELETE SET NULL,
  assignee_employee_id       TEXT REFERENCES employees(id) ON DELETE SET NULL,
  assigned_by_actor_id       TEXT,
  title                      TEXT NOT NULL,
  description                TEXT,
  linked_entity_kind         TEXT,
  linked_entity_id           TEXT,
  status                     assignment_status NOT NULL DEFAULT 'draft',
  priority                   INTEGER NOT NULL DEFAULT 3,
  due_at                     TIMESTAMPTZ,
  risk_level                 TEXT DEFAULT 'MEDIUM',
  estimated_effort_minutes   INTEGER,
  accepted_at                TIMESTAMPTZ,
  started_at                 TIMESTAMPTZ,
  completed_at               TIMESTAMPTZ,
  completion_evidence        JSONB DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 TEXT,
  updated_by                 TEXT
);
CREATE INDEX IF NOT EXISTS assignments_tenant_idx ON assignments(tenant_id);
CREATE INDEX IF NOT EXISTS assignments_team_idx ON assignments(team_id);
CREATE INDEX IF NOT EXISTS assignments_assignee_idx ON assignments(assignee_employee_id);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments(tenant_id, status);
CREATE INDEX IF NOT EXISTS assignments_due_at_idx ON assignments(due_at);
CREATE INDEX IF NOT EXISTS assignments_linked_idx ON assignments(linked_entity_kind, linked_entity_id);

-- Performance records (append-only) ----------------------------------------

CREATE TABLE IF NOT EXISTS performance_records (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind                performance_kind NOT NULL,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  scores              JSONB DEFAULT '{}'::jsonb,
  observer_actor_id   TEXT,
  note                TEXT,
  assignment_id       TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  visibility_scope    TEXT NOT NULL DEFAULT 'management',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT
);
CREATE INDEX IF NOT EXISTS performance_records_tenant_idx ON performance_records(tenant_id);
CREATE INDEX IF NOT EXISTS performance_records_employee_idx ON performance_records(employee_id);
CREATE INDEX IF NOT EXISTS performance_records_kind_idx ON performance_records(tenant_id, kind);
CREATE INDEX IF NOT EXISTS performance_records_assignment_idx ON performance_records(assignment_id);

-- Row Level Security -------------------------------------------------------

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY departments_tenant_isolation ON departments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY teams_tenant_isolation ON teams
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY employees_tenant_isolation ON employees
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY team_memberships_tenant_isolation ON team_memberships
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY assignments_tenant_isolation ON assignments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY performance_records_tenant_isolation ON performance_records
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
