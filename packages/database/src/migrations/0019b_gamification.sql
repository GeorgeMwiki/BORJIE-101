-- Migration: Gamification bundle (NEW 9)
-- MISSING_FEATURES_DESIGN.md §9 / RESEARCH_ANSWERS.md Q3 (Till-model 3-layer)

DO $$ BEGIN
  CREATE TYPE reward_tier AS ENUM ('bronze','silver','gold','platinum');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reward_event_type AS ENUM (
    'payment_posted','on_time_payment','early_payment','late_payment',
    'streak_continued','streak_broken','tier_upgraded','tier_downgraded',
    'early_pay_credit_granted','early_pay_credit_redeemed',
    'cashback_queued','cashback_paid','late_fee_applied','policy_updated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reward Policies
CREATE TABLE IF NOT EXISTS reward_policies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  on_time_points integer NOT NULL DEFAULT 10,
  early_payment_bonus_points integer NOT NULL DEFAULT 5,
  late_penalty_points integer NOT NULL DEFAULT -15,
  streak_bonus_points integer NOT NULL DEFAULT 2,
  bronze_threshold integer NOT NULL DEFAULT 0,
  silver_threshold integer NOT NULL DEFAULT 100,
  gold_threshold integer NOT NULL DEFAULT 300,
  platinum_threshold integer NOT NULL DEFAULT 600,
  early_pay_discount_bps integer NOT NULL DEFAULT 0,
  early_pay_min_days_before integer NOT NULL DEFAULT 3,
  early_pay_max_credit_minor integer NOT NULL DEFAULT 0,
  late_fee_bps integer NOT NULL DEFAULT 0,
  late_fee_grace_days integer NOT NULL DEFAULT 3,
  late_fee_max_minor integer NOT NULL DEFAULT 0,
  cashback_enabled boolean NOT NULL DEFAULT false,
  cashback_bps integer NOT NULL DEFAULT 0,
  cashback_monthly_cap_minor integer NOT NULL DEFAULT 0,
  cashback_provider text,
  extra jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz
);

CREATE INDEX IF NOT EXISTS reward_policy_tenant_idx ON reward_policies(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS reward_policy_tenant_version_uniq ON reward_policies(tenant_id, version);
CREATE INDEX IF NOT EXISTS reward_policy_active_idx ON reward_policies(active);

-- Tenant Gamification Profile (append-only snapshots)
CREATE TABLE IF NOT EXISTS tenant_gamification_profile (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id),
  score integer NOT NULL DEFAULT 0,
  tier reward_tier NOT NULL DEFAULT 'bronze',
  streak_months integer NOT NULL DEFAULT 0,
  longest_streak_months integer NOT NULL DEFAULT 0,
  total_on_time_payments integer NOT NULL DEFAULT 0,
  total_late_payments integer NOT NULL DEFAULT 0,
  early_pay_credit_balance_minor integer NOT NULL DEFAULT 0,
  early_pay_credit_currency text,
  cashback_month_to_date_minor integer NOT NULL DEFAULT 0,
  cashback_lifetime_minor integer NOT NULL DEFAULT 0,
  as_of timestamptz NOT NULL DEFAULT now(),
  source_event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gm_profile_tenant_idx ON tenant_gamification_profile(tenant_id);
CREATE INDEX IF NOT EXISTS gm_profile_customer_idx ON tenant_gamification_profile(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS gm_profile_tenant_customer_as_of_uniq
  ON tenant_gamification_profile(tenant_id, customer_id, as_of);
CREATE INDEX IF NOT EXISTS gm_profile_tier_idx ON tenant_gamification_profile(tier);

-- Reward Events (append-only)
CREATE TABLE IF NOT EXISTS reward_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id),
  event_type reward_event_type NOT NULL,
  policy_id text REFERENCES reward_policies(id),
  score_delta integer NOT NULL DEFAULT 0,
  credit_delta_minor integer NOT NULL DEFAULT 0,
  cashback_delta_minor integer NOT NULL DEFAULT 0,
  currency text,
  payment_id text,
  invoice_id text,
  from_tier reward_tier,
  to_tier reward_tier,
  payload jsonb DEFAULT '{}',
  dedup_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_event_tenant_idx ON reward_events(tenant_id);
CREATE INDEX IF NOT EXISTS reward_event_customer_idx ON reward_events(customer_id);
CREATE INDEX IF NOT EXISTS reward_event_type_idx ON reward_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS reward_event_dedup_uniq ON reward_events(dedup_key);
CREATE INDEX IF NOT EXISTS reward_event_occurred_at_idx ON reward_events(occurred_at);
