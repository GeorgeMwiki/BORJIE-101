-- =============================================================================
-- Migration 0184 — Persona Registry table
--
-- Phase D D7 — durable backing for the kernel's `PersonaRegistry` so platform
-- admins can hot-swap a persona's voice / taboos / opening statement WITHOUT a
-- deploy. Backs `createPersonaRegistryService(db)` (packages/database) and the
-- persona-registry admin router (services/api-gateway, SUPER_ADMIN / ADMIN).
--
-- The Drizzle schema (schemas/persona-registry.schema.ts) defined this table
-- but NO active migration created it — the admin router returned 503 forever.
-- This forward-only migration closes that gap.
--
-- One row per persona id (e.g. 'tenant-resident'). `tenant_id` NULL means
-- "platform-wide default" (the brain hydrates these for EVERY tenant at boot);
-- non-NULL is a tenant-scoped override the brain falls back to on a miss.
--
-- RLS: FORCE + tenant-nullable isolation. Platform rows (tenant_id IS NULL) are
-- visible under every tenant context so the brain's boot hydration sees the
-- shared personas; tenant rows are visible ONLY under the matching
-- `app.current_tenant_id` GUC. Mirrors the canonical `oauth_device_codes`
-- idiom (migration 0118) exactly — never a bare `tenant_id = GUC` predicate,
-- which would hide the platform defaults and blank the brain's persona map.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS persona_registry (
  id                 text        PRIMARY KEY,
  -- NULL ⇒ platform-wide default persona (shared across all tenants).
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  display_name       text        NOT NULL,
  opening_statement  text        NOT NULL,
  tone_guidance      text        NOT NULL,
  taboos             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  violation_signals  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  first_person_noun  text        NOT NULL,
  metadata           jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_registry_tenant
  ON persona_registry (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_persona_registry_tenant_name
  ON persona_registry (tenant_id, display_name);

ALTER TABLE persona_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_registry FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'persona_registry'
       AND policyname = 'persona_registry_tenant_isolation'
  ) THEN
    CREATE POLICY persona_registry_tenant_isolation
      ON persona_registry
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
