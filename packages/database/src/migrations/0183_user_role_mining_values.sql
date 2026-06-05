-- =============================================================================
-- Migration 0183 — UserRole → mining vocabulary (DB-side of INT-5, part 4)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Sibling agents rename the persisted UserRole vocabulary from the legacy
-- property domain to the mining domain in the TypeScript / domain layers
-- concurrently (authz-policy, role-aware-advisor, stage-advisor, …). This is
-- the DB-side counterpart so any persisted role row, enum label, or CHECK
-- constraint converges on ONE vocabulary alongside the code rename.
--
-- CANONICAL MAP (old -> new):
--     'property-manager' / 'property_manager' -> 'site-manager'
--     'landlord'                              -> 'owner'
--     'leasing-officer'  / 'leasing_officer'  -> 'offtake-officer'
--     'caretaker'                             -> 'site-supervisor'
--
-- KEEP VERBATIM (NEVER renamed) — SaaS org / tenant-admin roles and roles that
-- already mean mining:
--     'tenant_admin', 'org-admin', 'sovereign-admin', 'estate-manager',
--     'owner' (already mining), plus the canonical mining `borjie_user_role`
--     labels ('admin','site_manager','supervisor','driver','geologist',
--     'stores','qc_officer','buyer','borjie_team'). Also KEEP tenant_id /
--     multi-tenancy, Kenya / KRA, ledger money columns, estate / portfolio.
--
-- IMPORTANT — 'landlord' -> 'owner' COLLISION GUARD
-- -------------------------------------------------
-- The canonical `borjie_user_role` pgEnum already contains 'owner'. Renaming a
-- legacy 'landlord' label to 'owner' inside a type that ALREADY has 'owner'
-- would violate enum-label uniqueness. The §1 guard therefore skips a rename
-- whenever the NEW label already exists in the same type — the legacy 'landlord'
-- label only ever lived in a *separate* legacy role type, never alongside the
-- mining 'owner'. On the canonical enum the whole migration is a clean no-op.
--
-- WHAT IS PERSISTED (state at authoring time)
-- -------------------------------------------
-- The canonical persisted role column is `users.mining_role` backed by the
-- `borjie_user_role` pgEnum (drizzle `tenant.schema.ts`), which ALREADY holds
-- mining values — it never carried the legacy property labels. The legacy
-- property role vocabulary (dash-form) lives only in TS packages. `roles.name`
-- is free text (per-tenant role rows). To make the cross-package guarantee hold
-- for ANY deployed database that may still carry a legacy role enum/label/row
-- (e.g. a pilot DB seeded before the rename), while staying a clean no-op on a
-- fresh / current DB, every rewrite below is data-driven and guarded:
--
--   §1 enum labels: discover every enum type in `public` that still carries a
--      legacy role label and `ALTER TYPE ... RENAME VALUE` it in place
--      (collision-guarded as above). Postgres updates dependent rows atomically.
--
--   §2 free-text role columns: discover every text column named like a role
--      ('role', 'mining_role', 'role_name', 'name' on a `roles`-style table,
--      'role_key', 'primary_role') and UPDATE matching rows old -> new.
--
--   §3 CHECK constraints: discover any CHECK enumerating a legacy role value and
--      swap the literal inside the constraint definition so a renamed text value
--      is not rejected by a stale allow-list.
--
-- All sections are re-run safe (old values no longer match on re-run). FORCE-RLS
-- on tenant-scoped tables is UNAFFECTED — only cell values / enum labels / check
-- predicates change, never policies, ownership, or the RLS flag. No money
-- columns touched. Forward-only, append-only per CLAUDE.md "Migrations are
-- immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — enum-value labels (in-place rename auto-updates dependent rows).
--      Covers both dash-form and underscore-form legacy spellings.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['property-manager', 'site-manager'],
    ARRAY['property_manager', 'site-manager'],
    ARRAY['landlord',         'owner'],
    ARRAY['leasing-officer',  'offtake-officer'],
    ARRAY['leasing_officer',  'offtake-officer'],
    ARRAY['caretaker',        'site-supervisor']
    -- 'estate-manager', 'tenant_admin', 'org-admin', 'sovereign-admin',
    -- 'owner' and the canonical mining labels are intentionally NOT mapped.
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
         -- Collision guard: never create a duplicate label in the same type
         -- (protects 'landlord' -> 'owner' on any type already carrying 'owner').
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
-- §2 — free-text role columns (data-driven across the public schema).
--      `roles.name` is free text; `mining_role` may be text in some deploys.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['property-manager', 'site-manager'],
    ARRAY['property_manager', 'site-manager'],
    ARRAY['landlord',         'owner'],
    ARRAY['leasing-officer',  'offtake-officer'],
    ARRAY['leasing_officer',  'offtake-officer'],
    ARRAY['caretaker',        'site-supervisor']
  ];
  rec RECORD;
  m   text[];
BEGIN
  FOR rec IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying')
       AND (
         c.column_name IN (
           'role', 'mining_role', 'role_name', 'role_key', 'primary_role'
         )
         -- `name` only on a roles-style table, so we never rewrite unrelated
         -- `name` columns elsewhere.
         OR (c.column_name = 'name' AND c.table_name ILIKE '%role%')
       )
  LOOP
    FOREACH m SLICE 1 IN ARRAY mapping LOOP
      EXECUTE format('UPDATE public.%I SET %I = %L WHERE %I = %L',
                     rec.table_name, rec.column_name, m[2],
                     rec.column_name, m[1]);
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — CHECK constraints that enumerate a legacy role value.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['property-manager', 'site-manager'],
    ARRAY['property_manager', 'site-manager'],
    ARRAY['landlord',         'owner'],
    ARRAY['leasing-officer',  'offtake-officer'],
    ARRAY['leasing_officer',  'offtake-officer'],
    ARRAY['caretaker',        'site-supervisor']
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
       AND (
         pg_get_constraintdef(con.oid) LIKE '%''property-manager''%'
         OR pg_get_constraintdef(con.oid) LIKE '%''property_manager''%'
         OR pg_get_constraintdef(con.oid) LIKE '%''landlord''%'
         OR pg_get_constraintdef(con.oid) LIKE '%''leasing-officer''%'
         OR pg_get_constraintdef(con.oid) LIKE '%''leasing_officer''%'
         OR pg_get_constraintdef(con.oid) LIKE '%''caretaker''%'
       )
  LOOP
    new_src := rec.src;
    FOREACH m SLICE 1 IN ARRAY mapping LOOP
      new_src := replace(new_src, '''' || m[1] || '''', '''' || m[2] || '''');
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
                   rec.table_name, rec.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
                   rec.table_name, rec.conname, new_src);
  END LOOP;
END $$;

COMMIT;
