-- ============================================================================
-- MD Employees — employees, employee_sentiment_events, onboarding_plans
--
-- The MD's view of the owner's team. Every row is tenant-scoped and
-- subject to RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  hire_date TIMESTAMPTZ NOT NULL,
  manager UUID NULL REFERENCES employees(id) ON DELETE SET NULL,
  last_1on1_at TIMESTAMPTZ NULL,
  feedback_received_at TIMESTAMPTZ NULL,
  sentiment TEXT NULL
    CHECK (sentiment IN ('positive', 'neutral', 'concerning')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NULL
);

COMMENT ON TABLE employees IS
  'MD-tracked employees per tenant. Source of truth for 1-on-1 cadence and feedback aggregation.';

CREATE INDEX IF NOT EXISTS idx_employees_tenant_created
  ON employees (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employees_manager
  ON employees (manager)
  WHERE manager IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_last_1on1
  ON employees (tenant_id, last_1on1_at ASC NULLS FIRST);

CREATE TABLE IF NOT EXISTS employee_sentiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  polarity TEXT NOT NULL
    CHECK (polarity IN ('positive', 'neutral', 'negative')),
  score NUMERIC(4, 3) NOT NULL CHECK (score BETWEEN -1 AND 1),
  evidence TEXT NOT NULL,
  origin_turn_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE employee_sentiment_events IS
  'Per-mention sentiment events derived from MD chat turns. Append-only.';

CREATE INDEX IF NOT EXISTS idx_sentiment_employee_recorded
  ON employee_sentiment_events (employee_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_sentiment_tenant_recorded
  ON employee_sentiment_events (tenant_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  milestones JSONB NOT NULL,
  cadence_days INTEGER NOT NULL CHECK (cadence_days BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE onboarding_plans IS
  'Auto-drafted 30-60-90 plans + 1-on-1 cadence per new hire.';

CREATE INDEX IF NOT EXISTS idx_onboarding_employee
  ON onboarding_plans (employee_id, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION employees_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_touch_updated_at ON employees;
CREATE TRIGGER trg_employees_touch_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION employees_touch_updated_at();

DROP TRIGGER IF EXISTS trg_onboarding_plans_touch_updated_at ON onboarding_plans;
CREATE TRIGGER trg_onboarding_plans_touch_updated_at
  BEFORE UPDATE ON onboarding_plans
  FOR EACH ROW
  EXECUTE FUNCTION employees_touch_updated_at();

-- Sentiment events are append-only — block mutation entirely.
CREATE OR REPLACE FUNCTION sentiment_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'employee_sentiment_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sentiment_events_immutable
  ON employee_sentiment_events;
CREATE TRIGGER trg_sentiment_events_immutable
  BEFORE UPDATE OR DELETE ON employee_sentiment_events
  FOR EACH ROW
  EXECUTE FUNCTION sentiment_events_immutable();

-- ============================================================================
-- RLS — tenant-scoped.
-- ============================================================================

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_sentiment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_select_own_tenant
  ON employees FOR SELECT TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY employees_insert_own_tenant
  ON employees FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY employees_update_own_tenant
  ON employees FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY employees_delete_own_tenant
  ON employees FOR DELETE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY sentiment_select_own_tenant
  ON employee_sentiment_events FOR SELECT TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY sentiment_insert_own_tenant
  ON employee_sentiment_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY plans_select_own_tenant
  ON onboarding_plans FOR SELECT TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY plans_insert_own_tenant
  ON onboarding_plans FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY plans_update_own_tenant
  ON onboarding_plans FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
