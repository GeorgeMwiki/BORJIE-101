-- =============================================================================
-- Migration 0180 — kernel_tier (AwarenessTier) → mining vocabulary
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- WHY THIS MIGRATION EXISTS (INT-5 — DB side)
-- -------------------------------------------
-- The brain kernel's awareness-tier vocabulary is being renamed from the
-- legacy property domain to the mining domain as a COORDINATED cross-package
-- pass. The canonical target lives in
-- `packages/central-intelligence/src/kernel/kernel-types.ts` (`AwarenessTier`):
--
--     'lease'    -> 'offtake'   (one offtake / supply agreement)
--     'unit'     -> 'pit'       (one workable pit)
--     'block'    -> 'zone'      (one zone of pits)
--     'property' -> 'site'      (one site)
--
-- The KEEP values 'tenant' (multi-tenancy), 'portfolio', 'org', 'industry'
-- are preserved verbatim. api-gateway, observability, and the kernel-substrate
-- TS schema/service rename to the SAME values concurrently so DB rows + code
-- end on one vocabulary.
--
-- WHAT IS PERSISTED
-- -----------------
-- The `kernel_tier` pgEnum (drizzle schema `kernel-substrate.schema.ts`) backs
-- `kernel_provenance.tier`. The enum + tables are materialised via `drizzle-kit
-- push` (they have no numbered CREATE in this chain), so this migration is
-- written DEFENSIVELY: each rename is guarded on the existence of BOTH the
-- `kernel_tier` type AND the old label. On a DB that already carries the type,
-- `ALTER TYPE ... RENAME VALUE` renames the label IN PLACE — every existing
-- `kernel_provenance.tier` row is updated atomically by Postgres, no row
-- UPDATE required. On a DB where the type is absent (fresh CI apply before the
-- drizzle push), every guard is a clean no-op.
--
-- IDEMPOTENT / FORWARD-ONLY: guarded `ALTER TYPE ... RENAME VALUE` is safe to
-- re-run (re-run finds no old label and skips). No money columns touched. No
-- multi-tenancy / Kenya / KRA columns touched. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- 'lease' -> 'offtake'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'kernel_tier' AND e.enumlabel = 'lease'
  ) THEN
    ALTER TYPE kernel_tier RENAME VALUE 'lease' TO 'offtake';
  END IF;
END $$;

-- 'unit' -> 'pit'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'kernel_tier' AND e.enumlabel = 'unit'
  ) THEN
    ALTER TYPE kernel_tier RENAME VALUE 'unit' TO 'pit';
  END IF;
END $$;

-- 'block' -> 'zone'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'kernel_tier' AND e.enumlabel = 'block'
  ) THEN
    ALTER TYPE kernel_tier RENAME VALUE 'block' TO 'zone';
  END IF;
END $$;

-- 'property' -> 'site'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'kernel_tier' AND e.enumlabel = 'property'
  ) THEN
    ALTER TYPE kernel_tier RENAME VALUE 'property' TO 'site';
  END IF;
END $$;

COMMIT;
