-- ─────────────────────────────────────────────────────────────────────
-- Migration 0196 — Persona bindings (Piece D).
--
-- Many-to-many: a user can be bound to multiple personas within a tenant
-- (e.g. a manager may also act as auditor for one report). One default
-- per (user, tenant). `title_id` is the human-readable label the tenant
-- uses to address this user — driven off the `titles` table (0199).
--
-- Bindings carry an implicit constraint: the persona's power_tier must
-- be ≥ the title's power_tier (a CUSTOMER title cannot be bound to a
-- T1_owner_strategist persona). The runtime enforces this — the
-- migration leaves the constraint out so seeding order is flexible.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_bindings (
  id                          TEXT PRIMARY KEY,
  user_id                     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- title_id is referenced softly (not a hard FK) until 0199 lands.
  -- Migration 0199 adds the constraint after the table exists.
  title_id                    TEXT NOT NULL,
  persona_id                  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id, persona_id)
);

CREATE INDEX IF NOT EXISTS idx_persona_bindings_user_tenant
  ON persona_bindings (user_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_persona_bindings_tenant
  ON persona_bindings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_persona_bindings_persona
  ON persona_bindings (persona_id);

-- At most one default persona per (user, tenant).
CREATE UNIQUE INDEX IF NOT EXISTS uq_persona_bindings_user_tenant_default
  ON persona_bindings (user_id, tenant_id)
  WHERE is_default = TRUE;

COMMENT ON TABLE persona_bindings IS
  'Piece D — user→persona bindings within a tenant. is_default picks the persona the brain adopts when the user opens a session without explicit selection.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS persona_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS persona_bindings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'persona_bindings') THEN
    DROP POLICY IF EXISTS persona_bindings_tenant_isolation ON persona_bindings;
    CREATE POLICY persona_bindings_tenant_isolation ON persona_bindings
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS persona_bindings_tenant_isolation_write ON persona_bindings;
    CREATE POLICY persona_bindings_tenant_isolation_write ON persona_bindings
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
