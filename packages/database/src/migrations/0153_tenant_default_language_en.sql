-- Migration 0153 — flip tenant.default_language column default to 'en'.
--
-- Per CLAUDE.md hard-rule "English default · bilingual sw/en" (added in
-- commit 951fd0e5, 2026-05-31). New tenants are seeded English by
-- default; Tanzanian users can toggle to `sw` from the settings panel.
-- Toggle behaviour is ABSOLUTE — see the persona LOCALE LOCK directives
-- (services/api-gateway/src/routes/public-chat.hono.ts).
--
-- Existing rows are NOT touched — only the column DEFAULT is altered.
-- Tenants that previously sat at `sw` remain at `sw` unless their
-- operator updates them via the jurisdiction-settings flow.

ALTER TABLE tenants
  ALTER COLUMN default_language SET DEFAULT 'en';
