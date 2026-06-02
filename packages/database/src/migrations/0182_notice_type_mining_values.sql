-- =============================================================================
-- Migration 0182 — NoticeType → mining vocabulary (DB-side of INT-5, part 3)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Sibling agents rename the NoticeType vocabulary from the legacy property
-- domain to the mining domain in the TypeScript / domain layers concurrently.
-- The canonical TS source is
-- `packages/domain-models/src/common/enums.ts` (`NoticeType` const +
-- `NoticeTypeSchema` zod). This migration is the DB-side counterpart so any
-- persisted notice-type row, enum label, or CHECK constraint converges on ONE
-- vocabulary alongside the code rename.
--
-- CANONICAL MAP (old -> new):
--     'eviction_notice'  -> 'licence_suspension_notice'
--     'eviction_warning' -> 'licence_suspension_warning'
--   (defensive — also map legacy lease_*/rent_* notice types should any be
--    persisted in a deployed DB):
--     'lease_violation'  -> 'offtake_violation'
--     'rent_overdue'     -> 'royalty_overdue'
--
-- KEEP (NEVER renamed): tenant_id / multi-tenancy, Kenya / KRA, ledger money
-- columns, 'estate' / 'portfolio'. None are touched below. All other notice
-- types ('payment_reminder', 'inspection_notice', 'court_summons', 'other', …)
-- are left verbatim.
--
-- WHAT IS PERSISTED (state at authoring time)
-- -------------------------------------------
-- As of this migration NONE of the NoticeType values are persisted in
-- packages/database as a pgEnum, CHECK constraint, or seeded row — `NoticeType`
-- lives only in the TS domain-models package (const + zod schema) and in
-- service-side string unions. To make the cross-package guarantee hold for ANY
-- deployed database that may carry legacy notice rows/labels (e.g. the live
-- pilot DB), while remaining a clean no-op on a fresh / current DB, every
-- rewrite below is fully data-driven and guarded:
--
--   §1 enum labels: discover every enum type in `public` that still carries a
--      legacy notice label and `ALTER TYPE ... RENAME VALUE` it in place.
--      Postgres updates every dependent row atomically — no row UPDATE needed.
--      A no-op when no such label exists.
--
--   §2 text columns: discover every `notice_type`, `notice_kind`, or `type`
--      text column on a table whose name contains 'notice' and UPDATE matching
--      rows old -> new. Scoping to notice tables avoids rewriting unrelated
--      generic `type` columns elsewhere in the schema.
--
--   §3 CHECK constraints: discover any CHECK on a notice table whose source
--      text enumerates a legacy notice value and replace the literal inside the
--      constraint definition, so a renamed text value is not rejected by a
--      stale allow-list. A no-op when no such constraint exists.
--
-- All sections are re-run safe: after the first apply the old values no longer
-- match, so a second run changes nothing. FORCE-RLS on tenant-scoped tables is
-- UNAFFECTED — only cell values / enum labels / check predicates are rewritten,
-- never policies, ownership, or the RLS flag. No money columns touched.
-- Forward-only, append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — enum-value labels (in-place rename auto-updates dependent rows).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['eviction_notice',  'licence_suspension_notice'],
    ARRAY['eviction_warning', 'licence_suspension_warning'],
    ARRAY['lease_violation',  'offtake_violation'],
    ARRAY['rent_overdue',     'royalty_overdue']
  ];
  m   text[];
  rec RECORD;
BEGIN
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    FOR rec IN
      SELECT t.typname
        FROM pg_enum e
        JOIN pg_type t      ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
         AND e.enumlabel = m[1]
         -- Skip if the NEW label already exists in the SAME type (would
         -- collide on rename). In practice the two never co-exist.
         AND NOT EXISTS (
           SELECT 1 FROM pg_enum e2
            WHERE e2.enumtypid = t.oid AND e2.enumlabel = m[2]
         )
    LOOP
      EXECUTE format('ALTER TYPE public.%I RENAME VALUE %L TO %L',
                     rec.typname, m[1], m[2]);
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §2 — notice-type text columns (data-driven across notice tables).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['eviction_notice',  'licence_suspension_notice'],
    ARRAY['eviction_warning', 'licence_suspension_warning'],
    ARRAY['lease_violation',  'offtake_violation'],
    ARRAY['rent_overdue',     'royalty_overdue']
  ];
  rec RECORD;
  m   text[];
BEGIN
  FOR rec IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name ILIKE '%notice%'
       AND c.column_name IN ('notice_type', 'notice_kind', 'type')
       AND c.data_type IN ('text', 'character varying')
  LOOP
    FOREACH m SLICE 1 IN ARRAY mapping LOOP
      EXECUTE format('UPDATE public.%I SET %I = %L WHERE %I = %L',
                     rec.table_name, rec.column_name, m[2],
                     rec.column_name, m[1]);
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — CHECK constraints that enumerate a legacy notice value. Rebuild the
--      constraint with the legacy literal swapped for its mining replacement
--      so the renamed text value is not rejected by a stale allow-list.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['eviction_notice',  'licence_suspension_notice'],
    ARRAY['eviction_warning', 'licence_suspension_warning'],
    ARRAY['lease_violation',  'offtake_violation'],
    ARRAY['rent_overdue',     'royalty_overdue']
  ];
  rec RECORD;
  m   text[];
  new_src text;
BEGIN
  FOR rec IN
    SELECT con.conname,
           rel.relname AS table_name,
           pg_get_constraintdef(con.oid) AS src
      FROM pg_constraint con
      JOIN pg_class rel      ON rel.oid = con.conrelid
      JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
     WHERE con.contype = 'c'
       AND nsp.nspname = 'public'
       AND rel.relname ILIKE '%notice%'
       AND (
         pg_get_constraintdef(con.oid) LIKE '%eviction_notice%'
         OR pg_get_constraintdef(con.oid) LIKE '%eviction_warning%'
         OR pg_get_constraintdef(con.oid) LIKE '%lease_violation%'
         OR pg_get_constraintdef(con.oid) LIKE '%rent_overdue%'
       )
  LOOP
    new_src := rec.src;
    FOREACH m SLICE 1 IN ARRAY mapping LOOP
      new_src := replace(new_src, '''' || m[1] || '''', '''' || m[2] || '''');
    END LOOP;
    -- pg_get_constraintdef() returns "CHECK (...)"; ALTER ADD CONSTRAINT wants
    -- the same "CHECK (...)" tail, so the definition is reusable verbatim.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
                   rec.table_name, rec.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
                   rec.table_name, rec.conname, new_src);
  END LOOP;
END $$;

COMMIT;
