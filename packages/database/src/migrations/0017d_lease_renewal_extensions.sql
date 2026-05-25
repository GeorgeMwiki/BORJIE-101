-- =============================================================================
-- 0017: Lease renewal workflow columns
-- =============================================================================
-- Additive columns on `leases` to support the explicit renewal workflow:
--   - renewal_status            Tracks the renewal lifecycle stage
--   - renewal_window_opened_at  When the renewal window was opened
--   - renewal_proposed_at       When a renewal proposal was sent
--   - renewal_proposed_rent     Proposed monthly rent (minor units)
--   - renewal_decided_at        When tenant accepted/declined
--   - renewal_decision_by       Who recorded the decision
--   - termination_date          Effective termination date (distinct from
--                               terminated_at audit column)
--   - termination_reason_notes  Free-form reason text (enum already exists)
--
-- Leases are immutable once decided; acceptRenewal creates a NEW lease row and
-- links via previous_lease_id (already exists on the table).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE renewal_status AS ENUM (
    'not_started',
    'window_opened',
    'proposed',
    'accepted',
    'declined',
    'terminated',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS renewal_status renewal_status
    NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS renewal_window_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_proposed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_proposed_rent    INTEGER,
  ADD COLUMN IF NOT EXISTS renewal_decided_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_decision_by      TEXT,
  ADD COLUMN IF NOT EXISTS termination_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termination_reason_notes TEXT;

CREATE INDEX IF NOT EXISTS leases_renewal_status_idx
  ON leases(renewal_status);
CREATE INDEX IF NOT EXISTS leases_renewal_window_opened_at_idx
  ON leases(renewal_window_opened_at);
