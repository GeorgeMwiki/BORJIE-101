-- =============================================================================
-- 0089: Tenant Credit Rating (FICO-scale 300-850)
-- =============================================================================
-- Internal risk tool AND portable credit certificate. Real-payment-only,
-- opt-in sharing across landlords, per-tenant configurable weights.
--
-- Four tables:
--   credit_rating_snapshots    — append-only rating results
--   credit_rating_promises     — extension/installment outcomes
--   credit_rating_weights      — per-tenant FICO weight overrides
--   credit_rating_sharing_opt_ins — revocable cross-landlord consents
-- =============================================================================

-- --- Snapshots --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_rating_snapshots (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- FICO 300-850; NULL when band='insufficient_data'.
  numeric_score       INTEGER,
  letter_grade        TEXT CHECK (letter_grade IN ('A','B','C','D','F')),
  band                TEXT NOT NULL CHECK (band IN (
                        'excellent','good','fair','poor','very_poor','insufficient_data'
                      )),
  weakest_factor      TEXT,
  strongest_factor    TEXT,
  data_freshness      TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (data_freshness IN ('fresh','stale','unknown')),
  insufficient_data_reason TEXT,

  -- Dimension breakdown (normalized 0-1 scores with weights + explanations)
  dimensions          JSONB NOT NULL,

  -- Raw inputs snapshot (for reproducibility)
  inputs              JSONB NOT NULL,
  recommendations     JSONB NOT NULL DEFAULT '[]'::jsonb,

  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_rating_snapshots_tenant
  ON credit_rating_snapshots(tenant_id, customer_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_rating_snapshots_band
  ON credit_rating_snapshots(tenant_id, band);

CREATE INDEX IF NOT EXISTS idx_credit_rating_snapshots_customer_latest
  ON credit_rating_snapshots(customer_id, computed_at DESC);

-- --- Promise outcomes -------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_rating_promises (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  kind                TEXT NOT NULL CHECK (kind IN (
                        'extension','installment','lease_amendment'
                      )),
  agreed_date         TIMESTAMPTZ NOT NULL,
  due_date            TIMESTAMPTZ NOT NULL,
  actual_outcome      TEXT NOT NULL CHECK (actual_outcome IN (
                        'on_time','late','defaulted','pending'
                      )),
  delay_days          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,

  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_rating_promises_tenant_customer
  ON credit_rating_promises(tenant_id, customer_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_rating_promises_kind
  ON credit_rating_promises(tenant_id, kind, recorded_at DESC);

-- --- Per-tenant weights -----------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_rating_weights (
  tenant_id           TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  payment_history     DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  promise_keeping     DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  rent_to_income      DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  tenancy_length      DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  dispute_history     DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          TEXT,

  -- Sanity: every weight non-negative; sum validated by application layer.
  CONSTRAINT weights_non_negative CHECK (
    payment_history >= 0 AND
    promise_keeping >= 0 AND
    rent_to_income >= 0 AND
    tenancy_length >= 0 AND
    dispute_history >= 0
  )
);

-- --- Opt-in cross-landlord sharing ------------------------------------------
CREATE TABLE IF NOT EXISTS credit_rating_sharing_opt_ins (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Opaque identifier for the recipient org — could be another tenant id
  -- in BORJIE, or a free-form label like 'KCB Bank' for external share.
  share_with_org      TEXT NOT NULL,
  purpose             TEXT NOT NULL DEFAULT 'tenancy_application',

  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credit_rating_sharing_opt_ins_customer
  ON credit_rating_sharing_opt_ins(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_credit_rating_sharing_opt_ins_active
  ON credit_rating_sharing_opt_ins(tenant_id, customer_id, expires_at)
  WHERE revoked_at IS NULL;
