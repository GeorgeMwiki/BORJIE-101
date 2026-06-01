-- =============================================================================
-- Migration 0171 — owner_calendar_connections: the owner's linked Google
-- Calendar / Microsoft 365 account so Mr. Mwikila's reminders + the autonomous
-- worker's time-bound items (licence renewals 90/60/30-day, royalty deadlines,
-- shifts) post as real calendar EVENTS in the owner's own calendar.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The reminder pipeline already delivers email (Resend) and SMS. This adds a
-- `calendar` delivery channel: once the owner connects Google / Microsoft via
-- OAuth (offline access + calendar scope), the calendar-sync worker upserts a
-- calendar event per reminder/item, idempotently, on a stable external id (the
-- reminder/item id). The owner sees Borjie's deadlines natively in the same
-- calendar they already live in.
--
-- ENCRYPTED TOKENS (CLAUDE.md / SECURITY hard rule)
-- -------------------------------------------------
-- OAuth refresh + access tokens are long-lived credentials to the owner's
-- calendar. They are stored ENCRYPTED only — never plaintext. The api-gateway
-- `CalendarTokenCipher` seals them with AES-256-GCM (key from CALENDAR_TOKEN_KEY
-- / ENCRYPTION_MASTER_KEY env) before they reach this table; the column holds
-- the opaque `v1.gcm.<nonce>.<tag>.<ciphertext>` blob. There is no plaintext
-- token column by design, so no code path can persist one by mistake.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0164's CORRECT
--     GUC; never the legacy app.tenant_id). REVOKE anon (guarded for vanilla
--     PG / CI empty-PG).
--   * user_id is carried for per-user scoping (a connection belongs to one
--     owner) but RLS isolates by TENANT; the app additionally predicates on
--     user_id in every query (belt-and-braces, matching the repo handlers).
--   * provider is TEXT with a CHECK ('google' | 'microsoft') — no pg_enum so
--     the migration stays forward-only + re-runnable.
--   * At most one ACTIVE connection per (tenant, user, provider): a partial
--     UNIQUE index on revoked_at IS NULL. Re-connecting soft-revokes the old
--     row first (app-side) so the unique never collides.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — owner_calendar_connections
--
-- encrypted_refresh_token / encrypted_access_token hold the AES-256-GCM sealed
-- blobs (never plaintext). token_expires_at drives the just-in-time access-token
-- refresh. calendar_id is the target calendar ('primary' by default for Google,
-- the user's default calendar for MS). scope records the granted OAuth scopes.
-- revoked_at soft-deletes a disconnected connection so the unique-active index
-- frees up while the audit row survives.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_calendar_connections (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  user_id                  TEXT NOT NULL,
  provider                 TEXT NOT NULL
                             CHECK (provider IN ('google','microsoft')),
  -- AES-256-GCM sealed blobs ("v1.gcm.<nonce>.<tag>.<ct>"). NEVER plaintext.
  encrypted_refresh_token  TEXT NOT NULL,
  encrypted_access_token   TEXT,
  token_expires_at         TIMESTAMPTZ,
  calendar_id              TEXT NOT NULL DEFAULT 'primary',
  scope                    TEXT,
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at               TIMESTAMPTZ
);

-- Status / refresh hot path: "this user's ACTIVE connection for this tenant".
CREATE INDEX IF NOT EXISTS owner_calendar_connections_tenant_user_idx
  ON owner_calendar_connections(tenant_id, user_id);

-- At most ONE active (non-revoked) connection per (tenant, user, provider).
-- Partial unique on revoked_at IS NULL: a soft-revoked row no longer occupies
-- the slot, so re-connecting after a disconnect never collides.
CREATE UNIQUE INDEX IF NOT EXISTS owner_calendar_connections_active_uniq
  ON owner_calendar_connections(tenant_id, user_id, provider)
  WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0164 §2: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the repo's INSERT (callback), the
-- status SELECT, the refresh UPDATE, and the disconnect UPDATE. Idempotent:
-- ENABLE/FORCE are no-ops if already set; policy guarded by a pg_policies
-- existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'owner_calendar_connections'
  ) THEN
    EXECUTE 'ALTER TABLE public.owner_calendar_connections ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.owner_calendar_connections FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'owner_calendar_connections'
        AND policyname = 'owner_calendar_connections_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY owner_calendar_connections_tenant_isolation
        ON public.owner_calendar_connections
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.owner_calendar_connections FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE owner_calendar_connections IS
  'Owner-linked Google Calendar / Microsoft 365 account for the `calendar` '
  'reminder delivery channel. OAuth refresh/access tokens are stored ENCRYPTED '
  '(AES-256-GCM, key from env) — never plaintext. Mr. Mwikila reminders + the '
  'autonomous worker time-bound items upsert as native calendar events on a '
  'stable external id (idempotent, no dupes on retry). Tenant+user scoped with '
  'FORCE RLS on app.current_tenant_id. At most one active connection per '
  '(tenant,user,provider) via partial unique on revoked_at IS NULL. NO money '
  'columns. Added in 0171.';

COMMIT;
