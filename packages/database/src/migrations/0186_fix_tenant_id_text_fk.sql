-- =============================================================================
-- Migration 0186 — Correct-typed tenant_id (text) for request_for_bids,
--                  request_for_bid_responses, owner_delegation_prefs,
--                  and mwikila_actions_inbox
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
--
-- WHY THIS EXISTS (INT-7 / migration-apply-check failures #3, #4, #5):
--
--   Migrations 0127, 0128, and 0129 declare tenant_id as UUID with a FK
--   to tenants(id). However, tenants.id is TEXT (established in
--   drizzle/0000_borjie_bootstrap.sql line 74). Postgres rejects FK
--   constraints where the referencing column type does not match the
--   referenced column type — both the CREATE TABLE statements in those
--   migrations fail at the FK clause on a fresh DB.
--
--   Those shipped files are immutable. This migration creates the tables
--   with the CORRECT tenant_id TEXT type and all canonical indexes, RLS,
--   and comments. Because it uses CREATE TABLE IF NOT EXISTS, production
--   databases where the tables already exist (created via the cutover apply
--   path before this fix landed) are unaffected.
--
-- PRODUCTION NOTE:
--   Production has these tables from an earlier apply path where the UUID
--   FK constraint was not enforced (Supabase performs some FK coercion, or
--   the tables were created by a different mechanism). This fixup ensures
--   fresh-DB applies (CI + new-tenant bootstrap) succeed. Any production
--   schema drift is handled by the existing 0150_fix_tenant_id_text_drift.sql
--   coercion strategy.
--
-- RLS: FORCE-enabled per CLAUDE.md hard rule. Policies match 0127/0128/0129.
-- IDEMPOTENT: all DDL guarded with IF NOT EXISTS / DO blocks.
-- =============================================================================

BEGIN;

-- ─── 1. request_for_bids ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS request_for_bids (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mineral_kind     TEXT NOT NULL,
  grade_min        TEXT,
  tonnage_min      NUMERIC(10,3) NOT NULL,
  tonnage_max      NUMERIC(10,3),
  unit_price_tzs   NUMERIC(15,2) NOT NULL,
  delivery_by      DATE NOT NULL,
  location_lat     NUMERIC(9,6),
  location_lon     NUMERIC(9,6),
  radius_km        INTEGER NOT NULL DEFAULT 200,
  status           TEXT NOT NULL DEFAULT 'open',
  notes            TEXT,
  provenance       JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',

  CONSTRAINT request_for_bids_status_check CHECK (
    status IN ('open', 'filled', 'expired', 'cancelled')
  ),
  CONSTRAINT request_for_bids_tonnage_min_positive CHECK (tonnage_min > 0),
  CONSTRAINT request_for_bids_tonnage_max_check CHECK (
    tonnage_max IS NULL OR tonnage_max >= tonnage_min
  ),
  CONSTRAINT request_for_bids_unit_price_positive CHECK (unit_price_tzs > 0),
  CONSTRAINT request_for_bids_radius_range CHECK (
    radius_km > 0 AND radius_km <= 5000
  )
);

CREATE INDEX IF NOT EXISTS request_for_bids_tenant_status_mineral_idx
  ON request_for_bids (tenant_id, status, mineral_kind);

CREATE INDEX IF NOT EXISTS request_for_bids_open_geo_idx
  ON request_for_bids (location_lat, location_lon)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS request_for_bids_provenance_gin_idx
  ON request_for_bids USING gin (provenance);

CREATE INDEX IF NOT EXISTS request_for_bids_expires_at_idx
  ON request_for_bids (expires_at)
  WHERE status = 'open';

-- ─── 2. request_for_bid_responses ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS request_for_bid_responses (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rfb_id            TEXT NOT NULL REFERENCES request_for_bids(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seller_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offered_tonnage   NUMERIC(10,3) NOT NULL,
  offered_price_tzs NUMERIC(15,2) NOT NULL,
  delivery_by       DATE NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  provenance        JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT rfb_responses_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  CONSTRAINT rfb_responses_tonnage_positive CHECK (offered_tonnage > 0),
  CONSTRAINT rfb_responses_price_positive CHECK (offered_price_tzs > 0)
);

CREATE INDEX IF NOT EXISTS rfb_responses_rfb_status_idx
  ON request_for_bid_responses (rfb_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS rfb_responses_tenant_seller_idx
  ON request_for_bid_responses (tenant_id, seller_id, created_at DESC);

-- ─── 3. owner_delegation_prefs ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_delegation_prefs (
  id                         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category                   TEXT NOT NULL,
  tier                       TEXT NOT NULL DEFAULT 'T0',
  reversal_window_hours      INTEGER,
  envelope_threshold_tzs     NUMERIC(15,2),
  set_by_user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  set_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT owner_delegation_prefs_tier_check CHECK (
    tier IN ('T0', 'T1', 'T2', 'T3')
  ),
  CONSTRAINT owner_delegation_prefs_reversal_range CHECK (
    reversal_window_hours IS NULL OR
    (reversal_window_hours BETWEEN 1 AND 168)
  ),
  CONSTRAINT owner_delegation_prefs_envelope_positive CHECK (
    envelope_threshold_tzs IS NULL OR envelope_threshold_tzs >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_delegation_prefs_tenant_category_unique
  ON owner_delegation_prefs (tenant_id, category);

CREATE INDEX IF NOT EXISTS owner_delegation_prefs_tenant_set_at_idx
  ON owner_delegation_prefs (tenant_id, set_at DESC);

-- ─── 4. mwikila_actions_inbox ────────────────────────────────────────────────
-- Full column set mirrors 0129_mwikila_actions_inbox.sql with the single
-- correction: tenant_id TEXT (not UUID) to match tenants.id TEXT.

CREATE TABLE IF NOT EXISTS mwikila_actions_inbox (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  acting_on_user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_kind           TEXT NOT NULL,
  category              TEXT NOT NULL,
  delegation_tier       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'proposed',
  summary               TEXT NOT NULL,
  summary_sw            TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversal_token        UUID,
  reversal_until        TIMESTAMPTZ,
  proposed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proposal_ttl_at       TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  owner_reviewed_at     TIMESTAMPTZ,
  owner_reviewed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at           TIMESTAMPTZ,
  committed_at          TIMESTAMPTZ,
  audit_chain_hash      TEXT,
  decision_id           UUID,
  blocked_reason        TEXT,
  provenance            JSONB NOT NULL DEFAULT '{"via":"mwikila"}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mwikila_actions_inbox_tier_check CHECK (
    delegation_tier IN ('T0', 'T1', 'T2', 'T3')
  ),
  CONSTRAINT mwikila_actions_inbox_status_check CHECK (
    status IN (
      'proposed', 'owner_approved', 'owner_denied',
      'executed', 'reversed', 'committed',
      'blocked_by_inviolable', 'expired'
    )
  ),
  CONSTRAINT mwikila_actions_inbox_category_check CHECK (
    category IN (
      'shifts', 'payroll-prep', 'royalty-filing',
      'license-renewal-reminders', 'contract-followups',
      'worker-hires', 'worker-discipline', 'capex',
      'inventory-orders', 'compliance-filings',
      'marketplace-bids', 'marketplace-counters'
    )
  ),
  CONSTRAINT mwikila_actions_inbox_reversal_pair_check CHECK (
    (reversal_token IS NULL AND reversal_until IS NULL) OR
    (reversal_token IS NOT NULL AND reversal_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_tenant_status_idx
  ON mwikila_actions_inbox (tenant_id, status, proposed_at DESC);

CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_tenant_category_idx
  ON mwikila_actions_inbox (tenant_id, category, proposed_at DESC);

CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_reversal_due_idx
  ON mwikila_actions_inbox (reversal_until)
  WHERE status = 'executed' AND reversal_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_ttl_due_idx
  ON mwikila_actions_inbox (proposal_ttl_at)
  WHERE status = 'proposed' AND proposal_ttl_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mwikila_actions_inbox_reversal_token_unique
  ON mwikila_actions_inbox (reversal_token)
  WHERE reversal_token IS NOT NULL;

-- ─── RLS (FORCE) for all four tables ─────────────────────────────────────────

ALTER TABLE request_for_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bids FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'request_for_bids'
       AND policyname = 'rfb_tenant_isolation'
  ) THEN
    CREATE POLICY rfb_tenant_isolation
      ON request_for_bids
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

ALTER TABLE request_for_bid_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bid_responses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'request_for_bid_responses'
       AND policyname = 'rfb_responses_tenant_isolation'
  ) THEN
    CREATE POLICY rfb_responses_tenant_isolation
      ON request_for_bid_responses
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

ALTER TABLE owner_delegation_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_delegation_prefs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_delegation_prefs'
       AND policyname = 'owner_delegation_prefs_tenant_isolation'
  ) THEN
    CREATE POLICY owner_delegation_prefs_tenant_isolation
      ON owner_delegation_prefs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

ALTER TABLE mwikila_actions_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mwikila_actions_inbox FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mwikila_actions_inbox'
       AND policyname = 'mwikila_actions_inbox_tenant_isolation'
  ) THEN
    CREATE POLICY mwikila_actions_inbox_tenant_isolation
      ON mwikila_actions_inbox
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
