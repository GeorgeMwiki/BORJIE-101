-- =============================================================================
-- Down-migration 0345 — reverse the corrected buyer model + pairing states.
--
-- Dev/staging only. Reverses: identity_auth_principals (DROPPED — the
-- sub↔identity bridge is lost), invite_codes.relationship_type,
-- organizations.discoverable, the approval-metadata columns, the
-- buyer-no-shadow-user CHECK, and the user_id NOT NULL restoration.
--
-- DATA LOSS:
--   * identity_auth_principals rows (every sub↔identity mapping).
--   * Every buyer_connection membership row is DELETED — they carry
--     user_id IS NULL by 0345's invariant, and restoring NOT NULL would
--     otherwise fail. Buyers must re-pair after a re-apply.
--   * PENDING/REJECTED/REVOKED rows are DELETED (Postgres cannot drop enum
--     VALUES; the rows referencing them must go before the model reverts to
--     the three-state machine). The enum values themselves remain in the
--     type — harmless residue, documented.
--   * requested_note / decided_by / decided_at / decision_note discarded.
--
-- Fail-safe consequence: the membership graph reverts to the SC-1
-- insider-conflated shape; pairing mode (b) and the buyer leg go dark.
-- Request-path tenant isolation (0336 policies) is UNAFFECTED. No
-- money/licence/ledger records live in any touched table.
--
-- Reverses migration 0345_corrected_buyer_model_pairing_states.sql.
-- =============================================================================

BEGIN;

SELECT set_config('app.is_service_role', 'true', false);

-- Rows that the three-state machine cannot represent must go first.
DELETE FROM org_memberships WHERE status IN ('PENDING', 'REJECTED', 'REVOKED');
DELETE FROM org_memberships WHERE relationship_type = 'buyer_connection';

ALTER TABLE org_memberships
  DROP CONSTRAINT IF EXISTS org_memberships_buyer_no_shadow_user;

-- Any residual NULL user_id row (non-buyer) blocks NOT NULL — remove it.
DELETE FROM org_memberships WHERE user_id IS NULL;
ALTER TABLE org_memberships ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE org_memberships DROP COLUMN IF EXISTS requested_note;
ALTER TABLE org_memberships DROP COLUMN IF EXISTS decided_by;
ALTER TABLE org_memberships DROP COLUMN IF EXISTS decided_at;
ALTER TABLE org_memberships DROP COLUMN IF EXISTS decision_note;

ALTER TABLE invite_codes DROP COLUMN IF EXISTS relationship_type;

DROP INDEX IF EXISTS organizations_discoverable_idx;
ALTER TABLE organizations DROP COLUMN IF EXISTS discoverable;

DROP TABLE IF EXISTS identity_auth_principals;

-- Email-keyed identities cannot survive the NOT NULL restoration.
DROP INDEX IF EXISTS tenant_identities_email_key_idx;
ALTER TABLE tenant_identities
  DROP CONSTRAINT IF EXISTS tenant_identities_phone_or_email;
DELETE FROM tenant_identities WHERE phone_normalized IS NULL;
ALTER TABLE tenant_identities ALTER COLUMN phone_normalized SET NOT NULL;
UPDATE tenant_identities SET phone_country_code = 'ZZ'
 WHERE phone_country_code IS NULL;
ALTER TABLE tenant_identities ALTER COLUMN phone_country_code SET NOT NULL;

-- NOTE: 'PENDING'/'REJECTED'/'REVOKED' remain in org_membership_status —
-- Postgres has no ALTER TYPE ... DROP VALUE. Unreferenced enum values are
-- inert; a re-apply of 0345's ADD VALUE IF NOT EXISTS is a no-op.

COMMIT;
