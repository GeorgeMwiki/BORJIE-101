-- =============================================================================
-- Migration 0128 — Owner delegation preferences (Mwikila autonomous-MD)
--
-- Backs the Mwikila autonomy framework. Per-owner, per-category
-- delegation tier where:
--
--   T0  inform-only        Mr. Mwikila does not act; informs the owner.
--   T1  propose            Mwikila drafts; owner one-tap approves.
--   T2  act-with-reversal  Mwikila executes; reversal_window_hours
--                           lets the owner reverse via the inbox.
--   T3  irrevocable        Mwikila acts; no reversal. Rare, owner-elevated.
--
-- The default tier for every category is the safest one — set by the
-- autonomy handler when no row exists. Owners override per-category
-- via PATCH /v1/owner/delegation.
--
-- Tenant scope:
--   RLS FORCE per CLAUDE.md hard rule. tenant GUC bound by api-gateway
--   middleware.
--
-- Envelope guard:
--   `envelope_threshold_tzs` is the inviolable cap above which the
--   handler refuses to execute even at T3. Owners cannot raise it
--   above the platform-wide CLAUDE.md monthly threshold (enforced
--   in code, not in SQL — SQL stores the per-tenant value).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS owner_delegation_prefs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category                   TEXT NOT NULL,
  tier                       TEXT NOT NULL DEFAULT 'T0',
  -- Reversal window in hours for T2. NULL means use category default
  -- (24h for most; 4h for marketplace-counters).
  reversal_window_hours      INTEGER,
  -- Envelope cap above which no autonomous action fires (per-tenant
  -- mirror of the CLAUDE.md money-threshold). NULL means use the
  -- platform default.
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

-- Exactly one row per (tenant, category) — UPSERT-friendly.
CREATE UNIQUE INDEX IF NOT EXISTS owner_delegation_prefs_tenant_category_unique
  ON owner_delegation_prefs (tenant_id, category);

CREATE INDEX IF NOT EXISTS owner_delegation_prefs_tenant_set_at_idx
  ON owner_delegation_prefs (tenant_id, set_at DESC);

ALTER TABLE owner_delegation_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_delegation_prefs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_delegation_prefs_tenant_isolation
  ON owner_delegation_prefs;

CREATE POLICY owner_delegation_prefs_tenant_isolation
  ON owner_delegation_prefs
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE owner_delegation_prefs IS
  'Per-owner per-category delegation tier for Mr. Mwikila autonomous-MD. '
  'T0=inform / T1=propose / T2=act-with-reversal / T3=irrevocable. '
  'envelope_threshold_tzs and reversal_window_hours override defaults.';

COMMIT;
