-- =============================================================================
-- Down-migration 0346 — reverse the person_links → org_memberships unify
-- backfill + the PENDING approval-queue index.
--
-- Dev/staging only. Every backfilled row carries a DETERMINISTIC id prefix
-- ('mem_pl_' / 'usr_pl_' / 'org_pl_' / 'iap_pl_' / 'tid_pl_'), so the
-- reversal deletes EXACTLY what 0346 inserted — organically-created rows
-- (different prefixes) are untouched.
--
-- DATA LOSS: the backfilled memberships, shadow users, synthesized root
-- orgs, auth principals, and backfilled identities. /me/tenants reverts to
-- whatever person_links still holds (the table was never dropped), so the
-- owner-web tenant rail keeps working after a rollback of the READ-path
-- code. No money/licence/ledger records.
--
-- Reverses migration 0346_membership_unify_backfill.sql.
-- =============================================================================

BEGIN;

SELECT set_config('app.is_service_role', 'true', false);

DROP INDEX IF EXISTS org_memberships_org_pending_idx;

DELETE FROM org_memberships          WHERE id LIKE 'mem_pl_%';
DELETE FROM users                    WHERE id LIKE 'usr_pl_%';
DELETE FROM organizations            WHERE id LIKE 'org_pl_%';
DELETE FROM identity_auth_principals WHERE id LIKE 'iap_pl_%';

-- Backfilled identities only — and only when nothing else references them
-- (an organically-attached principal or membership keeps the identity).
DELETE FROM tenant_identities ti
 WHERE ti.id LIKE 'tid_pl_%'
   AND NOT EXISTS (
         SELECT 1 FROM org_memberships m WHERE m.tenant_identity_id = ti.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM identity_auth_principals iap
          WHERE iap.tenant_identity_id = ti.id
       );

COMMENT ON TABLE person_links IS NULL;

COMMIT;
