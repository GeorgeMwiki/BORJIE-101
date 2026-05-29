-- =============================================================================
-- Migration 0150 — Fix text/uuid tenant_id drift in 0127, 0128, 0129
--
-- Background
-- ----------
-- The dev DB (forked from BossNyumba) carries `tenants.id text`. The
-- Drizzle canonical schema at packages/database/src/schemas/tenant.schema.ts
-- also declares `text('id').primaryKey()`. Every tenant-scoped table in the
-- shipped DB (organizations, users, sites, …) carries `tenant_id text`
-- with `FOREIGN KEY (tenant_id) REFERENCES tenants(id)` accordingly.
--
-- Migrations 0127 (request_for_bids + responses), 0128 (owner_delegation_
-- prefs), and 0129 (mwikila_actions_inbox) were authored against the
-- assumption that `tenants.id` is `uuid`. They each declare:
--
--   tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
--
-- Postgres rejects FK creation between mismatched types
--   ERROR  42804  Key columns "tenant_id" and "id" are of incompatible types
-- so the CREATE TABLE inside each migration body throws. Because the
-- runner wraps each migration in sql.begin(), the partial state rolls
-- back and `__drizzle_migrations` does not get the INSERT — but the
-- runner halts on first failure, so later migrations don't auto-recover
-- (the audit doc shows 0131/0132/0133 came through a re-run that skipped
-- the broken 0127/0128/0129/0130 chain).
--
-- Symptoms
--   * `request_for_bids` and `request_for_bid_responses` tables missing
--   * `/api/v1/marketplace/rfb/mine` and `/api/v1/marketplace/rfb/nearby`
--     return 503 TABLE_NOT_PROVISIONED → R11 buyer RFB UI broken
--   * `owner_delegation_prefs` and `mwikila_actions_inbox` also missing
--     so autonomous-MD inbox and delegation-prefs surfaces 403/empty
--
-- Decision
-- --------
-- This migration creates the four missing tables with the corrected
-- `tenant_id TEXT REFERENCES tenants(id)` type. The alternative —
-- converting `tenants.id` from text → uuid — was rejected because:
--
--   1. Drizzle canonical schema (packages/database/src/schemas/
--      tenant.schema.ts L109) declares `text('id').primaryKey()`, which
--      is the gold-path the rest of the codebase already targets.
--   2. Live dev DB has 7 tenant rows, 5 of which carry non-UUID values
--      (`borjie-demo`, `tn_4fa3100a-…`, `bt_b7701457-…`) by design.
--      The `borjie-demo` ID is hard-coded in seed scripts (packages/
--      database/src/seeds/borjie-test-users.seed.ts), the test harness
--      (services/api-gateway/src/__tests__/test-user-isolation.test.ts),
--      and the SEED_TEST_TENANT_ID env var.
--   3. 85 existing FK constraints carry `tenant_id text`. A type lift
--      would require coordinated ALTER on every child column.
--
-- Migration 0130 onwards already use `tenant_id TEXT REFERENCES tenants(id)`
-- so 0127/0128/0129 are the only outliers. This migration is the
-- surgical fix.
--
-- Idempotency
-- -----------
-- * Each CREATE TABLE uses `IF NOT EXISTS`. If a prior remediation has
--   already created any of the four tables, re-running 0150 is a no-op
--   for that table.
-- * Every CREATE INDEX uses `IF NOT EXISTS`.
-- * RLS DROP POLICY IF EXISTS / CREATE POLICY pairs are safe to re-run.
-- * The `__drizzle_migrations` row is written by the runner, not by
--   this script.
--
-- Append-only
-- -----------
-- Per CLAUDE.md "Migrations are immutable", this file is a NEW migration.
-- We do NOT edit 0127, 0128, or 0129. They remain on disk but are no
-- longer the source of truth for these tables.
-- =============================================================================

BEGIN;

-- =============================================================================
-- §1. request_for_bids (R11 buyer-initiated RFB)
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_for_bids (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- =============================================================================
-- §2. request_for_bid_responses (R11 seller responses sidecar)
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_for_bid_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfb_id            UUID NOT NULL REFERENCES request_for_bids(id) ON DELETE CASCADE,
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

-- =============================================================================
-- §3. owner_delegation_prefs (Mwikila autonomy tier per category)
-- =============================================================================

CREATE TABLE IF NOT EXISTS owner_delegation_prefs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CONSTRAINT owner_delegation_prefs_category_check CHECK (
    category IN (
      'shifts',
      'payroll-prep',
      'royalty-filing',
      'license-renewal-reminders',
      'contract-followups',
      'worker-hires',
      'worker-discipline',
      'capex',
      'inventory-orders',
      'compliance-filings',
      'marketplace-bids',
      'marketplace-counters'
    )
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

-- =============================================================================
-- §4. mwikila_actions_inbox (Mwikila autonomous-MD action log)
-- =============================================================================

CREATE TABLE IF NOT EXISTS mwikila_actions_inbox (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
      'proposed',
      'owner_approved',
      'owner_denied',
      'executed',
      'reversed',
      'committed',
      'blocked_by_inviolable',
      'expired'
    )
  ),
  CONSTRAINT mwikila_actions_inbox_category_check CHECK (
    category IN (
      'shifts',
      'payroll-prep',
      'royalty-filing',
      'license-renewal-reminders',
      'contract-followups',
      'worker-hires',
      'worker-discipline',
      'capex',
      'inventory-orders',
      'compliance-filings',
      'marketplace-bids',
      'marketplace-counters'
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

-- =============================================================================
-- §5. Row-level security — RLS FORCE per CLAUDE.md hard rule
-- =============================================================================
-- Because tenant_id is now TEXT (matching tenants.id), the RLS predicate
-- compares directly to current_setting('app.current_tenant_id'). No
-- ::text cast needed (kept for clarity / future-proofing).

ALTER TABLE request_for_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bids FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfb_tenant_isolation ON request_for_bids;
CREATE POLICY rfb_tenant_isolation ON request_for_bids
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE request_for_bid_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bid_responses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfb_responses_tenant_isolation ON request_for_bid_responses;
CREATE POLICY rfb_responses_tenant_isolation ON request_for_bid_responses
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE owner_delegation_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_delegation_prefs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_delegation_prefs_tenant_isolation
  ON owner_delegation_prefs;
CREATE POLICY owner_delegation_prefs_tenant_isolation
  ON owner_delegation_prefs
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE mwikila_actions_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mwikila_actions_inbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mwikila_actions_inbox_tenant_isolation
  ON mwikila_actions_inbox;
CREATE POLICY mwikila_actions_inbox_tenant_isolation
  ON mwikila_actions_inbox
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- =============================================================================
-- §6. Table comments
-- =============================================================================

COMMENT ON TABLE request_for_bids IS
  'R11 buyer-initiated marketplace RFB. Buyer posts requirement '
  '(mineral, tonnage, price, delivery, radius); sellers within the '
  'geo predicate respond via request_for_bid_responses. Created via '
  'migration 0150 (text tenant_id) after 0127 silently failed.';

COMMENT ON TABLE request_for_bid_responses IS
  'R11 seller responses to buyer-initiated RFBs. Each row is one '
  'counter-offer; the buyer accepts ONE which flips the parent RFB '
  'to status=filled.';

COMMENT ON TABLE owner_delegation_prefs IS
  'Per-owner per-category delegation tier for Mr. Mwikila autonomous-MD. '
  'T0=inform / T1=propose / T2=act-with-reversal / T3=irrevocable. '
  'envelope_threshold_tzs and reversal_window_hours override defaults. '
  'Created via migration 0150 (text tenant_id) after 0128 silently failed.';

COMMENT ON TABLE mwikila_actions_inbox IS
  'Mr. Mwikila autonomous-MD actions inbox. Every proposal / execution / '
  'reversal lands here. Owner cockpit "Acting on your behalf" page renders '
  'this table with one-tap approve / deny / reverse + reversal-window countdown. '
  'Created via migration 0150 (text tenant_id) after 0129 silently failed.';

COMMIT;
