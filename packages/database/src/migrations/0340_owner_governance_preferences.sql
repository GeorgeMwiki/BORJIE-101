-- =============================================================================
-- Migration 0340 — owner_governance_preferences: the per-tenant governance
-- set-points the LIVING-MD organ reads FRESH on every tick (never cached).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The living-MD organ has owner-tunable governance knobs that MUST take effect
-- IMMEDIATELY — never on the next process restart, never from a cached value:
--   * autonomy_cap — the graded-corrective ceiling (nudge → draft → delegate).
--     Lowering it mid-session must clamp the very next reconcile tick (the
--     owner pulling back the MD's leash must be felt at once). Default is the
--     full graded ladder ('delegate' — itself a HITL park; the MD never
--     auto-actuates a sovereign action regardless of this cap).
--   * someday_review_cadence_days — how often the someday-review supervisor
--     resurfaces deferred long-horizon items for owner re-review (default 7).
--   * evidence_requirement_enforced — whether the Auditor rejects an empty
--     evidence chain (default true — the CLAUDE.md evidence-required hard rule;
--     this row can never relax it below the platform floor at the app layer).
--   * confirmation_probe_mappings — jsonb map of commitment kind → the
--     positive-proof confirmationKind the MD probes for on closure (e.g.
--     'royalty.filing' → 'regulator_ack'). closure-by-confirmation config.
--
-- ONE TABLE
--   * owner_governance_preferences — one row per tenant (PRIMARY KEY tenant_id).
--     Upsert-only at the app layer. The store reads it FRESH each tick so a
--     mid-turn governance change is honoured on the next tick with zero cache.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT PRIMARY KEY,
-- no FK — same convention as md_commitments). FORCE ROW LEVEL SECURITY with a
-- tenant-isolation policy on the canonical `app.current_tenant_id` GUC PLUS a
-- service-role bypass (mirroring 0321) so the out-of-band supervisor reads the
-- cadence while RLS FORCE isolates every request path. Guarded anon REVOKE.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE ... IF NOT EXISTS
-- + guarded DO-blocks + a pg_roles guard around the anon REVOKE. Every NOT NULL
-- is on a freshly-created column with a DEFAULT (no backfill hazard) so the
-- NOT-NULL safety validator passes. No seed rows — an absent row resolves to
-- the safe defaults in code (the store never assumes a row exists).
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/owner-governance-preferences.schema.ts
--   * services/api-gateway/src/composition/living-md/governance-store.ts
--   * packages/database/src/migrations/down/0340_down_owner_governance_preferences.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS owner_governance_preferences (
  tenant_id                      text        PRIMARY KEY,
  -- The graded-corrective ceiling. Clamped in code — never raised above
  -- 'delegate' (the owner-direct safe-halt, itself a HITL park).
  autonomy_cap                   text        NOT NULL DEFAULT 'delegate',
  -- Someday-review resurfacing cadence (days). Clamped to a sane band in code.
  someday_review_cadence_days    integer     NOT NULL DEFAULT 7,
  -- The evidence-required hard rule toggle (cannot relax below the floor in app).
  evidence_requirement_enforced  boolean     NOT NULL DEFAULT true,
  -- Commitment kind → positive-proof confirmationKind probe map (closure config).
  confirmation_probe_mappings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT owner_governance_prefs_autonomy_cap_chk CHECK (
    autonomy_cap IN ('observe', 'nudge', 'draft', 'delegate')
  ),
  CONSTRAINT owner_governance_prefs_cadence_chk CHECK (
    someday_review_cadence_days BETWEEN 1 AND 365
  )
);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band someday-review supervisor) + guarded anon REVOKE. Mirrors 0321.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'owner_governance_preferences'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
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

COMMENT ON TABLE owner_governance_preferences IS
  'Per-tenant governance set-points the living-MD organ reads FRESH each tick '
  '(never cached): autonomy_cap (graded-corrective ceiling, clamped ≤ delegate), '
  'someday_review_cadence_days, evidence_requirement_enforced (the CLAUDE.md '
  'evidence-required hard rule), confirmation_probe_mappings (closure-by-'
  'confirmation config). Upsert-only; an absent row resolves to safe defaults '
  'in code. FORCE RLS on app.current_tenant_id + service-role bypass.';

COMMIT;
