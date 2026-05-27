-- =============================================================================
-- Migration 0088 — Unified Personal Knowledge Base (Federated, NO RLS)
--
-- Companion to:
--   - Docs/research/unified-personal-kb.md §10
--   - packages/database/src/schemas/persons.schema.ts
--   - packages/database/src/schemas/personal-memory.schema.ts
--
-- Implements the §10 design from `Docs/research/unified-personal-kb.md`:
-- one canonical person identity that can wear many hats (owner / manager /
-- employee / buyer / admin) across many tenants. Three new tables:
--
--   1. persons               — the canonical human. Primary key is a UUID.
--                              Unique on `primary_phone_e164` (E.164).
--                              `consent_unified_kb_at` / `_revoked_at` model
--                              the GDPR Art. 7 + PDPA TZ Part V affirmative
--                              consent gate for cross-tenant federation.
--
--   2. person_links          — join table. One row per (person, tenant,
--                              supabase_user_id) triple. `role_in_tenant` is
--                              the canonical Borjie role set. `link_method`
--                              records HOW the link was established (phone-
--                              match auto, manual confirm, SSO claim, SSO
--                              merge). UNIQUE on the triple.
--
--   3. personal_memory_cells — the federated personal memory store. Mirrors
--                              the `platform_memory_cells` precedent
--                              (cognitive-memory.schema.ts §159): NO RLS,
--                              NO `tenant_id` column. Scoped by `person_id`
--                              only; the brain orchestrator UNION-ALLs this
--                              with tenant memory at turn time and a
--                              boundary tagger filters by origin.
--                              `source_tenant_id` is provenance-only — it
--                              is never used to filter access.
--
-- Why federated-no-RLS for personal_memory_cells (per R8 audit):
--   - `platform_memory_cells` already lives without RLS as the cross-tenant
--     federated cells precedent. Adding another tenant-style RLS predicate
--     would tank p95 and tempt authors to "filter from app code", which
--     CLAUDE.md hard rules forbid. Symmetric isolation is achieved by
--     binding `app.current_person_id` GUC at the api-gateway middleware
--     layer, the same shape we use for `app.current_tenant_id`.
--
-- Append-only. Forward-only. Immutable per CLAUDE.md "Migrations are
-- immutable". All paths absolute, all schema names verified.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- persons — canonical human identity
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persons (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_phone_e164              TEXT NOT NULL UNIQUE,
  primary_email                   TEXT NULL,
  display_name                    TEXT NOT NULL,
  preferred_language              TEXT NOT NULL DEFAULT 'sw'
                                    CHECK (preferred_language IN ('sw','en')),
  consent_unified_kb_at           TIMESTAMPTZ NULL,
  consent_unified_kb_revoked_at   TIMESTAMPTZ NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash_chain_id                   UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_persons_phone ON persons(primary_phone_e164);

-- -----------------------------------------------------------------------------
-- person_links — join (person × tenant × supabase_user). Many hats per human.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           UUID NOT NULL
                        REFERENCES persons(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  supabase_user_id    UUID NOT NULL,
  role_in_tenant      TEXT NOT NULL
                        CHECK (role_in_tenant IN (
                          'owner','manager','employee','buyer','admin'
                        )),
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at         TIMESTAMPTZ NULL,
  link_method         TEXT NOT NULL DEFAULT 'phone-match'
                        CHECK (link_method IN (
                          'phone-match','manual','sso','sso-merge'
                        )),
  UNIQUE (person_id, tenant_id, supabase_user_id)
);

CREATE INDEX IF NOT EXISTS idx_person_links_person
  ON person_links(person_id);
CREATE INDEX IF NOT EXISTS idx_person_links_tenant_user
  ON person_links(tenant_id, supabase_user_id);

-- -----------------------------------------------------------------------------
-- personal_memory_cells — federated personal memory (NO RLS, no tenant_id)
--
-- Mirrors the `platform_memory_cells` precedent. Scoped exclusively by
-- `person_id`. `source_tenant_id` is provenance only — the brain audit
-- chain records WHICH tenant context produced this cell, but access is
-- not gated by tenant_id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_memory_cells (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           UUID NOT NULL
                        REFERENCES persons(id) ON DELETE CASCADE,
  cell_kind           TEXT NOT NULL
                        CHECK (cell_kind IN (
                          'preference','context','recurring-fact',
                          'calibration','sentiment'
                        )),
  key                 TEXT NOT NULL,
  value               JSONB NOT NULL,
  confidence          NUMERIC(3,2) NOT NULL DEFAULT 1.0
                        CHECK (confidence BETWEEN 0 AND 1),
  source_tenant_id    UUID NULL,
  source_thread_id    UUID NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NULL,
  UNIQUE (person_id, cell_kind, key)
);

CREATE INDEX IF NOT EXISTS idx_personal_memory_person_kind
  ON personal_memory_cells(person_id, cell_kind);

-- -----------------------------------------------------------------------------
-- RLS posture (documented invariant)
--
-- `persons` and `person_links` are platform-level identity registries —
-- no tenant_id column, no RLS predicate. Access is gated by the api-
-- gateway service-role connection or a future `app.current_person_id`
-- GUC predicate; both routes live above this layer.
--
-- `personal_memory_cells` is federated by design (R8 audit precedent:
-- `platform_memory_cells`). NO ROW LEVEL SECURITY is enabled. Symmetric
-- isolation between person-memory and tenant-memory is enforced at the
-- brain orchestrator boundary-tagger layer per
-- `Docs/research/unified-personal-kb.md` §5.
-- -----------------------------------------------------------------------------

COMMIT;
