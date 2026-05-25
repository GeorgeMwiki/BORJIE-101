-- BORJIE Utilities Schema Updates
-- Adds status to utility_accounts and submitted_by to utility_readings

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE utility_account_status AS ENUM ('active', 'inactive', 'suspended', 'closed');

-- ============================================================================
-- Utility Accounts - Add status column
-- ============================================================================

ALTER TABLE utility_accounts
  ADD COLUMN IF NOT EXISTS status utility_account_status NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS utility_accounts_status_idx ON utility_accounts(status);

-- ============================================================================
-- Utility Readings - Add submitted_by column
-- ============================================================================

ALTER TABLE utility_readings
  ADD COLUMN IF NOT EXISTS submitted_by TEXT;
