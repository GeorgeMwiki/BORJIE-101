-- Closes operations.repository schema/repo drift documented in PR #132 (tracks #11)
--
-- 0167: ops-repo schema/repo drift — adds the columns that
-- `DispatchEventRepository.updateStatus`, `CompletionProofRepository.verify`,
-- `CompletionProofRepository.reject`, and `VendorAssignmentRepository.deactivate`
-- claim to write in `packages/database/src/repositories/operations.repository.ts`.
--
-- Until this migration, those methods would have failed at runtime with
-- "column ... does not exist" — but the repo file carried `// @ts-nocheck` so
-- the compiler never told us. PR #132 stripped the nocheck across the repo
-- layer, surfaced these as TS2344/TS2353, and re-applied a scoped nocheck
-- with TODO(#11) headers pending this follow-up.
--
-- All columns are nullable to preserve backwards compatibility with rows
-- inserted before this migration.

-- ----------------------------------------------------------------------------
-- 1) dispatch_events — lifecycle timestamps for DispatchEventRepository.updateStatus
--    (existing en_route_at + completed_at remain; adds the missing 3)
-- ----------------------------------------------------------------------------

ALTER TABLE "dispatch_events"
    ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "on_site_at"      timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cancelled_at"    timestamp with time zone;

-- ----------------------------------------------------------------------------
-- 2) completion_proofs — verify/reject audit columns for
--    CompletionProofRepository.verify / .reject
-- ----------------------------------------------------------------------------

ALTER TABLE "completion_proofs"
    ADD COLUMN IF NOT EXISTS "verified_by"      text,
    ADD COLUMN IF NOT EXISTS "verified_at"      timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "rejected_reason"  text,
    ADD COLUMN IF NOT EXISTS "rejected_at"      timestamp with time zone;

-- FK: verified_by → users.id (set null on user delete so we don't lose proofs)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.table_constraints
        WHERE  constraint_name  = 'completion_proofs_verified_by_users_id_fk'
        AND    table_name       = 'completion_proofs'
    ) THEN
        ALTER TABLE "completion_proofs"
            ADD CONSTRAINT "completion_proofs_verified_by_users_id_fk"
            FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "completion_proofs_verified_by_idx"
    ON "completion_proofs" ("verified_by");

-- ----------------------------------------------------------------------------
-- 3) vendor_assignments — soft-deactivation timestamp for
--    VendorAssignmentRepository.deactivate
-- ----------------------------------------------------------------------------

ALTER TABLE "vendor_assignments"
    ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
