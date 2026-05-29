-- =============================================================================
-- Migration 0145 — Tenant scale-tier discriminator (SC-1)
--
-- Companion to:
--   - packages/owner-os-tabs/src/scale-defaults.ts (default tabs per tier)
--   - services/api-gateway/src/services/orchestration/scale-flows.ts
--   - services/api-gateway/src/routes/orgs/signup.hono.ts (auto-detect on signup)
--   - packages/database/src/seeds/scale-fixtures/* (5 fixtures, one per tier)
--   - Docs/OPS/SCALE_TIERS.md
--
-- Wave: SCALE-AWARE (any mining size from 1-worker artisanal pit to a
-- 5,000-worker industrial group). The system is one product — we adapt
-- defaults, tab sets, persona register, and orchestration depth from a
-- single discriminator on `tenants`.
--
-- Tiers:
--   T1 artisanal    1-5 workers, single pit, no manager, owner is operator
--   T2 cooperative  5-50 workers, multi-pit, 1-2 supervisors, weekly settlement
--   T3 midtier      50-500 workers, multi-site, manager + admin, monthly payroll
--   T4 industrial   500-5000 workers, multi-region, full compliance + finance teams
--   T5 multi_country multi-tenant group, cross-border, multi-currency consolidation
--
-- The wizard (owner-web sign-up) collects (worker_count, site_count,
-- mineral_count, cross_border?) and the API computes a tier from this
-- tuple; the result is persisted here so every brain prompt and tab
-- defaulter can read it cheap.
--
-- BACKWARDS COMPATIBLE: every existing tenant defaults to 't1_artisanal'
-- (the safest, simplest tier). Per CLAUDE.md no existing tenant breaks.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- scale_tier — owner-org size discriminator.
-- Snake-case-prefixed values so they fit the existing CHECK-string pattern
-- used by `account_kind`, `kyc_status`, `primary_currency`, etc.
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS scale_tier text NOT NULL DEFAULT 't1_artisanal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_scale_tier_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_scale_tier_chk
      CHECK (scale_tier IN (
        't1_artisanal',
        't2_cooperative',
        't3_midtier',
        't4_industrial',
        't5_multi_country'
      ));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- scale_signals — opaque jsonb the auto-detect wizard persists so we can
-- recompute tier later (after worker invites land, after the second site
-- is added, etc.). Shape:
--   {
--     "workerCount": int,
--     "siteCount":   int,
--     "mineralCount": int,
--     "crossBorder": bool,
--     "computedAt":  iso8601
--   }
-- Kept tiny — no PII. The recomputer reads this, recomputes, updates
-- scale_tier if it changed and writes an audit-event for the transition.
-- -----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS scale_signals jsonb NOT NULL DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Helpful index — admin-web filters by tier, brain reads tier per turn.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tenants_scale_tier_idx
  ON tenants (scale_tier);

COMMIT;
