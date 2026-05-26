-- =============================================================================
-- Migration 0010 — Buyer ↔ user linkage
--
-- Replaces the `contactName == userId` heuristic in
-- services/api-gateway/src/routes/mining/bids.hono.ts `resolveBuyer()`
-- with a proper FK column on `buyers`. A buyer is now created exclusively
-- via POST /api/v1/mining/buyers/kyc, which sets `linked_user_id` to the
-- authenticated principal. The bids route refuses to place a bid until a
-- linked buyer row exists.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE IF EXISTS buyers
  ADD COLUMN IF NOT EXISTS linked_user_id text;

-- Backfill: rows lazily created by the old resolveBuyer heuristic stored
-- the user id verbatim in contact_name. Promote those values into the
-- new column so existing buyers can keep bidding without a fresh KYC.
UPDATE buyers
   SET linked_user_id = contact_name
 WHERE linked_user_id IS NULL
   AND contact_name IS NOT NULL
   AND contact_name <> '';

-- Add FK + uniqueness *after* backfill so the constraints don't reject
-- pre-existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'buyers_linked_user_id_fk'
      AND table_name = 'buyers'
  ) THEN
    ALTER TABLE buyers
      ADD CONSTRAINT buyers_linked_user_id_fk
        FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END$$;

-- One buyer per (tenant, user). NULL linked_user_id rows are allowed
-- (legacy / platform-level buyers without a portal account).
CREATE UNIQUE INDEX IF NOT EXISTS buyers_tenant_user_uniq_idx
  ON buyers(tenant_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS buyers_linked_user_idx
  ON buyers(linked_user_id);

COMMIT;
