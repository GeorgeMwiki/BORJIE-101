-- =============================================================================
-- Migration 0181 — enum-value + persona-id reconciliation → mining vocabulary
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- WHY THIS MIGRATION EXISTS (INT-5 — DB side, part 2)
-- --------------------------------------------------
-- Sibling agents rename the SAME legacy property values to mining values in
-- the TypeScript / domain layers concurrently. This migration is the DB-side
-- counterpart so any persisted row or enum label converges on ONE vocabulary.
--
-- CANONICAL MAP (old -> new):
--   enum / charge values:
--     'eviction'        -> 'licence_suspension'
--     'service_charge'  -> 'cooperative_levy'
--     'leasing'         -> 'offtake'
--     'tenant_welfare'  -> 'counterparty_welfare'
--     'rent_collection' -> 'royalty_collection'
--   persona ids:
--     'tenant-resident'  -> 'counterparty-resident'
--     'landlord'         -> 'owner'
--     'property-manager' -> 'site-manager'
--     'caretaker'        -> 'site-supervisor'
--     'leasing-officer'  -> 'offtake-officer'
--     ('estate-manager'  is KEPT verbatim)
--
-- KEEP (NEVER renamed): tenant_id / multi-tenancy, Kenya / KRA, 'estate',
-- 'portfolio', ledger_entries money columns. None are touched below.
--
-- SCOPE / DESIGN — DEFENSIVE + IDEMPOTENT
-- ---------------------------------------
-- As of this migration NONE of the enum-map values are persisted in
-- packages/database as a pgEnum, CHECK constraint, or seeded row, and the
-- persona ids appear only as loose `*_persona_id` text columns (no FK to a
-- titles table). To make the cross-package guarantee hold for ANY deployed
-- database that may still carry legacy rows/labels — while remaining a clean
-- no-op on a fresh / current DB — the rewrites below are fully data-driven and
-- guarded:
--
--   §1 enum labels: discover every enum type in `public` that still carries a
--      legacy label and `ALTER TYPE ... RENAME VALUE` it in place. Postgres
--      updates every dependent row atomically (no row UPDATE needed). A no-op
--      when no such label exists.
--
--   §2 persona-id text columns: discover every `persona_id`,
--      `primary_persona_id`, `source_persona_id`, `target_persona_id` text
--      column in `public` and UPDATE matching rows old -> new. Naturally covers
--      action_plans/steps, ai_decision_feedback, ai_semantic_memories,
--      conversation_capture, core_memory_blocks, cross_tenant_denials,
--      kernel_persona_drift_events, module_update_proposals, portal_layouts,
--      semantic_cache_log, tab_event_log, tab_subscriptions, threads,
--      handoff_packets — without a hardcoded table list that could drift from
--      the schema.
--
--   §3 persona_registry: the registry keys persona by `id` (not `persona_id`);
--      rewrite `id` for the mapped personas if the table exists.
--
-- All sections are re-run safe: after the first apply the old values no longer
-- match, so a second run changes nothing. FORCE-RLS on tenant-scoped tables is
-- UNAFFECTED — we only rewrite cell values / enum labels, never policies,
-- ownership, or the RLS flag. No money columns touched. Forward-only,
-- append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — enum-value labels (eviction / service_charge / leasing / tenant_welfare
--      / rent_collection). In-place label rename auto-updates dependent rows.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['eviction',        'licence_suspension'],
    ARRAY['service_charge',  'cooperative_levy'],
    ARRAY['leasing',         'offtake'],
    ARRAY['tenant_welfare',  'counterparty_welfare'],
    ARRAY['rent_collection', 'royalty_collection']
  ];
  m   text[];
  rec RECORD;
BEGIN
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    -- Skip if the NEW label already exists in a type that still has the OLD
    -- one (would collide); in practice the two never co-exist, but guard anyway.
    FOR rec IN
      SELECT t.typname
        FROM pg_enum e
        JOIN pg_type t      ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
         AND e.enumlabel = m[1]
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
-- §2 — persona-id text columns (data-driven across the whole public schema).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['tenant-resident',  'counterparty-resident'],
    ARRAY['landlord',         'owner'],
    ARRAY['property-manager', 'site-manager'],
    ARRAY['caretaker',        'site-supervisor'],
    ARRAY['leasing-officer',  'offtake-officer']
    -- 'estate-manager' intentionally NOT mapped (KEEP verbatim).
  ];
  rec RECORD;
  m   text[];
BEGIN
  FOR rec IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name IN (
         'persona_id', 'primary_persona_id',
         'source_persona_id', 'target_persona_id'
       )
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
-- §3 — persona_registry.id (registry keys persona by `id`, not `persona_id`).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['tenant-resident',  'counterparty-resident'],
    ARRAY['landlord',         'owner'],
    ARRAY['property-manager', 'site-manager'],
    ARRAY['caretaker',        'site-supervisor'],
    ARRAY['leasing-officer',  'offtake-officer']
  ];
  m text[];
BEGIN
  IF to_regclass('public.persona_registry') IS NOT NULL THEN
    FOREACH m SLICE 1 IN ARRAY mapping LOOP
      -- Only rewrite when the new id is free, so a partially-migrated registry
      -- never violates the PRIMARY KEY on a re-run.
      EXECUTE format(
        'UPDATE public.persona_registry SET id = %L
          WHERE id = %L
            AND NOT EXISTS (SELECT 1 FROM public.persona_registry r2 WHERE r2.id = %L)',
        m[2], m[1], m[2]);
    END LOOP;
  END IF;
END $$;

COMMIT;
