-- =============================================================================
-- Migration 0113 - Pinned Items (Wave SUPERPOWERS)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/pinned-items.hono.ts
--   - services/api-gateway/src/composition/brain-tools/superpowers-tools.ts
--   - apps/owner-web/src/components/home-chat/HomeChatTeach.tsx
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table backs the `mining.ui.bookmark` superpower so Mr. Mwikila
-- can pin a frequently-referenced entity (Geita PML, April royalty
-- filing, NEMC EIA, ...) to the owner's quick-access strip above the
-- dashboard. After the third reference to the same entity in chat,
-- Mr. Mwikila proactively suggests "Should I pin Geita PML to your
-- strip?".
--
-- Surface:
--   pinned_items - one row per (owner_id, entity_type, entity_id).
--   `position` orders the strip; `pinned_at` is the recency tiebreak.
--
-- Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate.
-- Owner-id is the second isolation key so Mr. Mwikila never pins one
-- co-owner's items to another's strip even within the same tenant.
-- RLS FORCE-enabled per the Borjie hard rule (CLAUDE.md).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pinned_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  owner_id        text        NOT NULL,
  /** Entity kind. Constrained at the API layer via the parser enum
   *  (see ui-navigate-parser.ts `bookmarkSchema`). */
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  /** Human label displayed on the pinned chip. Defaults at the API
   *  layer to the entity's canonical title. */
  label           text        NOT NULL,
  /** Drag-to-reorder position. Lower = leftmost. Tiebreaker: pinned_at. */
  position        integer     NOT NULL DEFAULT 0,
  pinned_at       timestamptz NOT NULL DEFAULT now(),
  unpinned_at     timestamptz,
  /** Universal provenance envelope (chat session, turn, persona slug). */
  provenance      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Soft-uniqueness: an owner pins each entity at most once. Re-pinning
-- after an unpin updates `unpinned_at` back to NULL and bumps position.
-- We enforce uniqueness only on ACTIVE rows so the index does not break
-- when an owner re-pins after unpinning.
CREATE UNIQUE INDEX IF NOT EXISTS pinned_items_owner_entity_active_idx
  ON pinned_items (tenant_id, owner_id, entity_type, entity_id)
  WHERE unpinned_at IS NULL;

-- Hot path: rendering the strip in order.
CREATE INDEX IF NOT EXISTS pinned_items_owner_position_idx
  ON pinned_items (tenant_id, owner_id, position ASC, pinned_at DESC)
  WHERE unpinned_at IS NULL;

ALTER TABLE pinned_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pinned_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pinned_items'
       AND policyname = 'pinned_items_tenant_isolation'
  ) THEN
    CREATE POLICY pinned_items_tenant_isolation
      ON pinned_items
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
