-- =============================================================================
-- Migration 0009 — Killswitch RBAC matrix
--
-- Two tables back the proper two-operator killswitch flow that replaces
-- the tenant-prefixed scope hack in
-- services/api-gateway/src/routes/mining/internal/killswitch.hono.ts:
--
--   1. killswitch_authorities             — append-only grant ledger
--   2. killswitch_pending_confirmations   — ephemeral two-operator state
--
-- RLS keys on `current_setting('app.user_id', true)` so a leaked DB
-- session cannot escalate beyond the JWT principal. Idempotent
-- (IF NOT EXISTS). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. killswitch_authorities — grant ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS killswitch_authorities (
  id                   text PRIMARY KEY,
  user_id              text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Glob-shaped: 'killswitch:platform:*', 'killswitch:tenant:<id>:*',
  -- 'killswitch:junior:<id>:*'. Prefix-matched at write time.
  scope                text NOT NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  granted_by_user_id   text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at           timestamptz
);

CREATE INDEX IF NOT EXISTS killswitch_authorities_user_idx
  ON killswitch_authorities(user_id);
CREATE INDEX IF NOT EXISTS killswitch_authorities_scope_idx
  ON killswitch_authorities(scope);
CREATE INDEX IF NOT EXISTS killswitch_authorities_active_idx
  ON killswitch_authorities(user_id, scope, revoked_at);

-- -----------------------------------------------------------------------------
-- 2. killswitch_pending_confirmations — ephemeral two-operator state
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS killswitch_pending_confirmations (
  id                       text PRIMARY KEY,
  -- { scope: 'platform' | 'tenant:<id>', level: 'live'|'degraded'|'halt',
  --   reasonCode: text, note?: text }
  killswitch_target        jsonb NOT NULL,
  initiator_user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  confirmed_by_user_id     text REFERENCES users(id) ON DELETE SET NULL,
  -- Hard 30 s window; the confirm route rejects when now() > expires_at.
  expires_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS killswitch_pending_initiator_idx
  ON killswitch_pending_confirmations(initiator_user_id);
CREATE INDEX IF NOT EXISTS killswitch_pending_expires_idx
  ON killswitch_pending_confirmations(expires_at);
CREATE INDEX IF NOT EXISTS killswitch_pending_confirmed_idx
  ON killswitch_pending_confirmations(confirmed_at);

-- -----------------------------------------------------------------------------
-- 3. RLS policies
-- -----------------------------------------------------------------------------

-- killswitch_authorities — readable only by the granted user (self) and
-- by anyone who already holds `killswitch:platform:*` (operators may
-- audit each other). Mutations are gated at the API layer via
-- SUPER_ADMIN role; we do not expose direct write paths to JWT clients.
ALTER TABLE killswitch_authorities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS killswitch_authorities_read ON killswitch_authorities;
CREATE POLICY killswitch_authorities_read ON killswitch_authorities
  USING (
    user_id = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1
      FROM killswitch_authorities granter
      WHERE granter.user_id = current_setting('app.user_id', true)
        AND granter.scope = 'killswitch:platform:*'
        AND granter.revoked_at IS NULL
    )
  );

-- killswitch_pending_confirmations — initiator and any platform operator
-- can read; the API enforces the confirmer-distinct-from-initiator rule.
ALTER TABLE killswitch_pending_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS killswitch_pending_read ON killswitch_pending_confirmations;
CREATE POLICY killswitch_pending_read ON killswitch_pending_confirmations
  USING (
    initiator_user_id = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1
      FROM killswitch_authorities a
      WHERE a.user_id = current_setting('app.user_id', true)
        AND a.scope = 'killswitch:platform:*'
        AND a.revoked_at IS NULL
    )
  );

COMMIT;
