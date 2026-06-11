-- =============================================================================
-- Down-migration 0344 — reverse the org_memberships relationship_type +
-- member_role columns.
--
-- Dev/staging only. Dropping these columns reverts org_memberships to the
-- status-only shape: the membership table can no longer distinguish a worker's
-- employment from a buyer's connection, and the audience resolver loses its
-- role-class targeting index. The fail-safe consequence: the surface-completion
-- down-cascade can no longer fan to a classified subset over these columns —
-- it falls back to the pre-existing per-tenant/global broadcast. NO
-- money/licence/ledger records live here.
--
-- DATA LOSS: discards every row's relationship_type (worker vs buyer) and
-- member_role targeting label. The enum type is dropped only if no other table
-- references it. Dev/staging rollback only.
--
-- Reverses migration 0344_org_membership_relationship_type.sql.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS org_memberships_org_relationship_active_idx;
DROP INDEX IF EXISTS org_memberships_org_member_role_active_idx;

ALTER TABLE org_memberships DROP COLUMN IF EXISTS member_role;
ALTER TABLE org_memberships DROP COLUMN IF EXISTS relationship_type;

-- Drop the enum only when nothing else depends on it (the column drop above
-- removes the sole dependency on a clean apply→reverse).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'org_membership_relationship_type'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_depend d
      JOIN pg_type t ON t.oid = d.refobjid
     WHERE t.typname = 'org_membership_relationship_type'
       AND d.deptype = 'n'
  ) THEN
    DROP TYPE org_membership_relationship_type;
  END IF;
END $$;

COMMIT;
