-- Migration: Add missing database entities
-- Date: 2026-02-13
-- Description: Adds Block, PaymentPlanAgreement, VendorScorecard, and Intelligence entities

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Payment Plan Status
DO $$ BEGIN
  CREATE TYPE payment_plan_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'active',
    'completed',
    'defaulted',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Preferred Channel for Customer Preferences
DO $$ BEGIN
  CREATE TYPE preferred_channel AS ENUM (
    'email',
    'sms',
    'whatsapp',
    'push',
    'in_app',
    'phone'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Communication Style
DO $$ BEGIN
  CREATE TYPE comms_style AS ENUM (
    'formal',
    'casual',
    'brief',
    'detailed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Action Type for Next Best Actions
DO $$ BEGIN
  CREATE TYPE action_type AS ENUM (
    'payment_reminder',
    'offer_payment_plan',
    'send_promotion',
    'schedule_check_in',
    'escalate_to_manager',
    'send_survey',
    'renewal_offer',
    'retention_outreach',
    'maintenance_follow_up',
    'welcome_message',
    'feedback_request'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Action Status
DO $$ BEGIN
  CREATE TYPE action_status AS ENUM (
    'pending',
    'scheduled',
    'executed',
    'completed',
    'skipped',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Action Outcome
DO $$ BEGIN
  CREATE TYPE action_outcome AS ENUM (
    'success',
    'partial_success',
    'no_response',
    'negative_response',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- BLOCKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS blocks_tenant_idx ON blocks(tenant_id);
CREATE INDEX IF NOT EXISTS blocks_property_idx ON blocks(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_name_property_idx ON blocks(property_id, name);

-- ============================================================================
-- ADD BLOCK_ID TO UNITS TABLE
-- ============================================================================

ALTER TABLE units ADD COLUMN IF NOT EXISTS block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS units_block_idx ON units(block_id);

-- ============================================================================
-- PAYMENT PLAN AGREEMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_plan_agreements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  lease_id TEXT REFERENCES leases(id),
  plan_number TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  installments JSONB NOT NULL DEFAULT '[]',
  status payment_plan_status NOT NULL DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES users(id),
  paid_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL,
  next_due_date TIMESTAMPTZ,
  next_due_amount INTEGER,
  completed_at TIMESTAMPTZ,
  defaulted_at TIMESTAMPTZ,
  default_reason TEXT,
  terms TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS payment_plan_agreements_tenant_idx ON payment_plan_agreements(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_plan_agreements_number_tenant_idx ON payment_plan_agreements(tenant_id, plan_number);
CREATE INDEX IF NOT EXISTS payment_plan_agreements_customer_idx ON payment_plan_agreements(customer_id);
CREATE INDEX IF NOT EXISTS payment_plan_agreements_lease_idx ON payment_plan_agreements(lease_id);
CREATE INDEX IF NOT EXISTS payment_plan_agreements_status_idx ON payment_plan_agreements(status);
CREATE INDEX IF NOT EXISTS payment_plan_agreements_next_due_date_idx ON payment_plan_agreements(next_due_date);

-- ============================================================================
-- VENDOR SCORECARDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vendor_scorecards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  period_month INTEGER NOT NULL,
  period_year INTEGER NOT NULL,
  response_time INTEGER,
  quality_score INTEGER,
  reopen_rate INTEGER,
  sla_compliance INTEGER,
  tenant_satisfaction INTEGER,
  cost_efficiency INTEGER,
  total_work_orders INTEGER NOT NULL DEFAULT 0,
  completed_work_orders INTEGER NOT NULL DEFAULT 0,
  on_time_completions INTEGER NOT NULL DEFAULT 0,
  average_rating INTEGER,
  overall_score INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS vendor_scorecards_tenant_idx ON vendor_scorecards(tenant_id);
CREATE INDEX IF NOT EXISTS vendor_scorecards_vendor_idx ON vendor_scorecards(vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_scorecards_vendor_period_idx ON vendor_scorecards(vendor_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS vendor_scorecards_period_year_idx ON vendor_scorecards(period_year, period_month);
CREATE INDEX IF NOT EXISTS vendor_scorecards_overall_score_idx ON vendor_scorecards(overall_score);

-- ============================================================================
-- CUSTOMER PREFERENCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_preferences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'en',
  preferred_channel preferred_channel DEFAULT 'email',
  quiet_hours JSONB DEFAULT '{}',
  comms_style comms_style DEFAULT 'formal',
  marketing_opt_in TEXT DEFAULT 'false',
  promotional_opt_in TEXT DEFAULT 'false',
  interests JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS customer_preferences_tenant_idx ON customer_preferences(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_preferences_customer_idx ON customer_preferences(customer_id);
CREATE INDEX IF NOT EXISTS customer_preferences_language_idx ON customer_preferences(language);
CREATE INDEX IF NOT EXISTS customer_preferences_channel_idx ON customer_preferences(preferred_channel);

-- ============================================================================
-- RISK SCORES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_scores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_risk_score INTEGER,
  churn_risk_score INTEGER,
  dispute_risk_score INTEGER,
  overall_risk_score INTEGER,
  risk_level TEXT,
  last_calculated TIMESTAMPTZ NOT NULL,
  calculation_version TEXT,
  factors JSONB NOT NULL DEFAULT '[]',
  score_history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS risk_scores_tenant_idx ON risk_scores(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS risk_scores_customer_idx ON risk_scores(customer_id);
CREATE INDEX IF NOT EXISTS risk_scores_payment_risk_idx ON risk_scores(payment_risk_score);
CREATE INDEX IF NOT EXISTS risk_scores_churn_risk_idx ON risk_scores(churn_risk_score);
CREATE INDEX IF NOT EXISTS risk_scores_overall_risk_idx ON risk_scores(overall_risk_score);
CREATE INDEX IF NOT EXISTS risk_scores_last_calculated_idx ON risk_scores(last_calculated);

-- ============================================================================
-- NEXT BEST ACTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS next_best_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action_type action_type NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  reasoning TEXT,
  confidence_score INTEGER,
  recommended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status action_status NOT NULL DEFAULT 'pending',
  executed_at TIMESTAMPTZ,
  executed_by TEXT,
  execution_channel TEXT,
  outcome action_outcome,
  outcome_details TEXT,
  outcome_recorded_at TIMESTAMPTZ,
  context JSONB DEFAULT '{}',
  parameters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS next_best_actions_tenant_idx ON next_best_actions(tenant_id);
CREATE INDEX IF NOT EXISTS next_best_actions_customer_idx ON next_best_actions(customer_id);
CREATE INDEX IF NOT EXISTS next_best_actions_action_type_idx ON next_best_actions(action_type);
CREATE INDEX IF NOT EXISTS next_best_actions_status_idx ON next_best_actions(status);
CREATE INDEX IF NOT EXISTS next_best_actions_priority_idx ON next_best_actions(priority);
CREATE INDEX IF NOT EXISTS next_best_actions_recommended_at_idx ON next_best_actions(recommended_at);
CREATE INDEX IF NOT EXISTS next_best_actions_customer_status_idx ON next_best_actions(customer_id, status);

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================

-- Create or replace the update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for all new tables with updated_at
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY['blocks', 'payment_plan_agreements', 'vendor_scorecards', 'customer_preferences', 'risk_scores', 'next_best_actions'];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
  END LOOP;
END $$;
