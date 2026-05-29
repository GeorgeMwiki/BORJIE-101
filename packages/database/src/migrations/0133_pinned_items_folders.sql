-- =============================================================================
-- Migration 0133 — Pinned items folder grouping (Wave SUPERPOWERS — Notion parity)
--
-- Adds two new columns to `pinned_items`:
--   - `folder_id`     UUID nullable — references a folder by id; NULL ⇒
--                     ungrouped (renders flat in the strip head).
--   - `folder_label`  TEXT nullable — denormalised folder name so the
--                     FE renders a section header without an extra
--                     query. Updated when the folder is renamed.
--
-- A folder is just a (tenant_id, owner_id, folder_id) triple — there is
-- no separate folders table. Folder identity is implicit in pinned-item
-- rows. This avoids a join and lets owners create + name folders in a
-- single PATCH call. Folder ordering follows the lowest `position` of
-- its member items.
--
-- SOTA peer: Notion nested favourites. Borjie picks the flat-with-
-- folder-tag model (lighter weight, easier to migrate to a real folders
-- table later without breaking the existing flat strip).
--
-- Tenant scope:
--   RLS FORCE per CLAUDE.md hard rule. Already-FORCE-enabled by
--   migration 0113. This change does not touch RLS.
-- =============================================================================

BEGIN;

ALTER TABLE pinned_items
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS folder_label TEXT;

-- Index for owner-scoped folder listing (used by GET /pinned-items
-- when grouping by folder).
CREATE INDEX IF NOT EXISTS pinned_items_owner_folder_idx
  ON pinned_items (tenant_id, owner_id, folder_id, position)
  WHERE unpinned_at IS NULL;

COMMIT;
