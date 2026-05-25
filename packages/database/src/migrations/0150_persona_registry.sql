-- ─────────────────────────────────────────────────────────────────────
-- Migration 0150 — Persona registry (Phase D D7).
--
-- Durable backing for the kernel's runtime PersonaRegistry. Lets a
-- platform-admin hot-swap a persona's voice / taboos / opening
-- statement WITHOUT a deploy. The brain hydrates from this table on
-- boot and refreshes after every admin write.
--
-- One row per (tenant_id, id) — tenant_id NULL is the platform-wide
-- default. JSONB arrays for taboos + violation_signals so we don't
-- proliferate side-tables for what is essentially a small string list.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_registry (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT,
  display_name       TEXT NOT NULL,
  opening_statement  TEXT NOT NULL,
  tone_guidance      TEXT NOT NULL,
  taboos             JSONB NOT NULL DEFAULT '[]'::jsonb,
  violation_signals  JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_person_noun  TEXT NOT NULL,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_persona_registry_taboos_array CHECK (
    jsonb_typeof(taboos) = 'array'
  ),
  CONSTRAINT ck_persona_registry_signals_array CHECK (
    jsonb_typeof(violation_signals) = 'array'
  ),
  CONSTRAINT ck_persona_registry_first_person CHECK (
    length(first_person_noun) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_persona_registry_tenant
  ON persona_registry (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_persona_registry_tenant_name
  ON persona_registry (tenant_id, display_name);

COMMENT ON TABLE persona_registry IS
  'DB-persisted persona definitions. Backs the kernel runtime PersonaRegistry so admins can hot-swap a persona without a deploy. tenant_id NULL is the platform-wide default; non-NULL rows are tenant-scoped overrides.';
