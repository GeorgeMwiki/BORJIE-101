-- =============================================================================
-- 0218: Unify Piece M workforce-orchestrator with legacy `employees` table.
--
-- The legacy `employees` table (from an earlier wave) already carries rich HR
-- columns (user_id, first_name, employment_type, capabilities, etc.). Piece M's
-- 0241_employees.sql assumed a green field and tried to create indexes on
-- `person_entity_id` / `title_id` / `default_channel` — none of which exist on
-- the legacy schema. The CREATE TABLE IF NOT EXISTS in 0241 was a no-op, then
-- the CREATE INDEX failed.
--
-- This migration is the unifier: ALTER TABLE adds Piece M's columns to the
-- legacy `employees` table, then re-creates the indexes Piece M needs.
-- =============================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS person_entity_id     text,                -- soft pointer to core_entity (Piece A)
  ADD COLUMN IF NOT EXISTS title_id             text,                -- soft pointer to titles (Piece D+F)
  ADD COLUMN IF NOT EXISTS default_channel      text NOT NULL DEFAULT 'web';

-- Indexes Piece M expects on the workforce model.
CREATE INDEX IF NOT EXISTS employees_person_entity_idx
  ON employees (person_entity_id) WHERE person_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_title_idx
  ON employees (title_id) WHERE title_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_tenant_status_idx
  ON employees (tenant_id, status);

COMMENT ON COLUMN employees.person_entity_id IS 'Piece M — soft pointer to core_entity (PERSON type) for the unified asset model.';
COMMENT ON COLUMN employees.title_id         IS 'Piece M — soft pointer to titles (Piece D+F) for power-tier resolution.';
COMMENT ON COLUMN employees.default_channel  IS 'Piece M — preferred channel for assignments/follow-ups: web|mobile|whatsapp|sms.';
