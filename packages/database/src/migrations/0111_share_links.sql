-- =============================================================================
-- Migration 0111 - Share Links (Wave SUPERPOWERS)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/share-links.hono.ts
--   - services/api-gateway/src/composition/brain-tools/superpowers-tools.ts
--   - apps/owner-web/src/components/home-chat/HomeChatTeach.tsx
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table backs the `mining.ui.share_view` superpower so Mr.
-- Mwikila can generate time-limited shareable links on the owner's
-- behalf when they ask to "send the April royalty filing to my
-- accountant" or "share the EIA decision with the regulator".
--
-- Surface:
--   share_links - one row per generated link. Tenant-scoped via the
--   canonical `app.tenant_id` GUC RLS predicate. RLS is FORCE-enabled
--   per the Borjie hard rule (CLAUDE.md).
--
-- Public resolution path (no JWT, token-only):
--   GET /api/v1/public/share/:token resolves to the entity payload.
--   The token is opaque (32+ chars random) and bound to a single
--   entity + expires_at + permission level. Used counter + last_used_at
--   surface anomalies in the audit view.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS share_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  /** Entity kind being shared. Free-form text constrained by an
   *  application-level enum (see ui-navigate-parser.ts `shareSchema`).
   *  Validated at the API layer; the DB stays liberal so new entity
   *  kinds can ship without a migration. */
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  /** Opaque URL-safe token. Generated server-side via gen_random_bytes
   *  and base64url-encoded. Indexed UNIQUE so the public resolver is
   *  O(1). NEVER log this column. */
  token           text        NOT NULL UNIQUE,
  /** Permission level. Mirrors the parser enum:
   *    'read'    - read-only viewer
   *    'comment' - read + post structured comments back through the API
   *    'edit'    - read + write (rare; requires a four-eye approval). */
  permission      text        NOT NULL DEFAULT 'read',
  expires_at      timestamptz NOT NULL,
  created_by_id   text        NOT NULL,
  /** Optional recipients (email addresses) the link was dispatched to
   *  via the reminders worker. NULL = link generated without
   *  dispatch (e.g. owner copies to clipboard). */
  recipients      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Lifecycle: created -> active (used >= 1) -> revoked | expired. */
  used_count      integer     NOT NULL DEFAULT 0,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  revoked_by_id   text,
  /** Universal provenance envelope (chat session, turn, persona slug,
   *  via='chat' or via='ui'). Mirrors `services/api-gateway/src/services/provenance`. */
  provenance      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'share_links_permission_chk'
  ) THEN
    ALTER TABLE share_links
      ADD CONSTRAINT share_links_permission_chk
      CHECK (permission IN ('read', 'comment', 'edit'));
  END IF;
END $$;

-- Hot path: token lookup for the public resolver.
CREATE UNIQUE INDEX IF NOT EXISTS share_links_token_idx
  ON share_links (token);

-- Hot path: owner-side listing ordered by recency.
CREATE INDEX IF NOT EXISTS share_links_tenant_created_idx
  ON share_links (tenant_id, created_at DESC);

-- Hot path: entity-scoped lookup (e.g. "all active shares for this draft").
CREATE INDEX IF NOT EXISTS share_links_tenant_entity_idx
  ON share_links (tenant_id, entity_type, entity_id)
  WHERE revoked_at IS NULL;

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'share_links'
       AND policyname = 'share_links_tenant_isolation'
  ) THEN
    CREATE POLICY share_links_tenant_isolation
      ON share_links
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
