-- =============================================================================
-- Migration 0330 — set_point_state: the closed-loop set-point regulation memory
-- (Wave-C C3 WIN-4 — perceive → act → re-observe → did-it-recover?).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The EstateMind RECONCILE sweep's set-point arc (reconcile-engine.ts:
-- evaluateSetPointDelta) compares last tick's drive breachSeverity to this
-- tick's to decide continuity-of-care: recovered (close), improving (suppress a
-- fresh nudge), or worsening N ticks (auto-promote the corrective rung). That
-- comparison needs a durable per-(tenant, drive_id) memory that round-trips
-- across ticks.
--
-- A DEDICATED table — NOT situational_model_entities — because that table's
-- `kind` column is a CLOSED enum (no `setpoint-state` member) AND it IS the
-- salience-arena snapshot the kernel reads each turn; a synthetic set-point
-- entity would both fail kind validation and POLLUTE the arena. The set-point
-- memory is its own small organ: one row per (tenant_id, drive_id).
--
--   * prior_breach_severity          numeric — last tick's [0,1] severity.
--   * consecutive_worsening_ticks    int     — the worsening-streak length that
--                                              drives the auto-promote (floor 3).
-- The unique (tenant_id, drive_id) index backs the store's upsert
-- (INSERT ... ON CONFLICT DO UPDATE) so a re-tick overwrites in place.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (`tenant_id` TEXT; no FK —
-- same repo shape as md_commitments / notification_preferences). FORCE-enables
-- RLS with a tenant-isolation policy on the canonical `app.current_tenant_id`
-- GUC plus a service-role bypass (the EstateMind sweep runs OUT OF BAND, so the
-- service-role path writes the memory while RLS FORCE isolates every request
-- caller), mirroring migration 0329 exactly. A TENANT can NEVER read ANOTHER
-- tenant's set-point regulation memory.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is in
-- the CREATE TABLE WITH a DEFAULT (prior_breach_severity 0,
-- consecutive_worsening_ticks 0, updated_at now()) so there is no backfill
-- hazard and the NOT-NULL safety validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/set-point-state.schema.ts
--   * services/api-gateway/src/composition/md-commitments/set-point-store.ts
--   * packages/database/src/migrations/down/0330_down_set_point_state.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- set_point_state — one row per (tenant_id, drive_id).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS set_point_state (
  id                           uuid          NOT NULL DEFAULT gen_random_uuid(),
  -- RLS isolation key (the owning tenant). No FK — text tenant id, repo shape.
  tenant_id                    text          NOT NULL,
  -- The standing drive this memory regulates (a DriveId slug, e.g.
  -- 'cash-runway' / 'licence-currency' / 'royalty-currency').
  drive_id                     text          NOT NULL,
  -- Last tick's [0,1] breach severity (the delta-evaluator compares to it).
  prior_breach_severity        numeric       NOT NULL DEFAULT 0,
  -- Worsening-streak length that drives the auto-promote (floor 3).
  consecutive_worsening_ticks  integer       NOT NULL DEFAULT 0,
  updated_at                   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT set_point_state_pkey PRIMARY KEY (id)
);

-- Upsert key + hot read path: one row per (tenant_id, drive_id).
CREATE UNIQUE INDEX IF NOT EXISTS set_point_state_tenant_drive_uniq
  ON set_point_state (tenant_id, drive_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0329 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'set_point_state'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
