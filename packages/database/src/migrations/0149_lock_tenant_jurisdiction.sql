-- =============================================================================
-- Migration 0149 — Lock tenant jurisdiction at signup (JC-4).
--
-- Companion to:
--   - services/api-gateway/src/routes/orgs/signup.hono.ts (JC-5 wiring)
--   - services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts (JC-7 override)
--
-- Per the JC-2/JC-6 invariant: a tenant CANNOT self-change their
-- jurisdiction via chat or settings. Only Borjie internal admins
-- (admin-web role) can revoke + reassign — through a four-eye
-- approval flow with a full audit chain entry.
--
-- This migration:
--
--   1. Adds `tenants.jurisdiction_locked_at` — the timestamp at
--      which the tenant's jurisdiction (country / regulator_set /
--      etc.) was frozen. Set automatically at signup (JC-5).
--
--   2. Adds `tenants.jurisdiction_locked_by_user_id` — Supabase user
--      id of the actor who locked it. NULL for backfilled rows since
--      the historical signup user may not be reliably attributable.
--
--   3. Backfills existing tenants as locked (defensive) — every row
--      with a non-null `country` (or `country_code`) gets a
--      `jurisdiction_locked_at` equal to its `created_at`. This
--      prevents any legacy tenant from accidentally falling through
--      the JC-6 self-change refusal.
--
-- BACKWARDS COMPATIBLE: no read-path breaks. The columns are
-- defaulted NULL and the backfill sets them to a sensible value;
-- the JC-5 signup writer will populate them for new tenants.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Forward-only. Append-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS jurisdiction_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS jurisdiction_locked_by_user_id text;

-- Foreign-key the locker to `users` so the audit chain can resolve
-- the locking actor. Guard against an already-applied constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE constraint_name = 'tenants_jurisdiction_locked_by_fk'
       AND table_name = 'tenants'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_jurisdiction_locked_by_fk
        FOREIGN KEY (jurisdiction_locked_by_user_id)
        REFERENCES users(id);
  END IF;
END
$$;

-- Backfill existing tenants. We treat the country column as the
-- presence test; the `jurisdiction` column itself does not exist on
-- the current tenants schema (the canonical signals are
-- `country` / `country_code` per migration 0143). Where neither is
-- set we leave the lock NULL — the JC-6 self-change guard treats
-- NULL as "no inherited lock yet", which is the safer default for
-- such edge rows.
UPDATE tenants
  SET jurisdiction_locked_at = COALESCE(jurisdiction_locked_at, created_at)
  WHERE country IS NOT NULL
    AND jurisdiction_locked_at IS NULL;

-- New tenants get locked at signup automatically — handled by
-- services/api-gateway/src/routes/orgs/signup.hono.ts in JC-5.

COMMIT;
