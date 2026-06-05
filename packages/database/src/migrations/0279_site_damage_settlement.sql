-- =============================================================================
-- Migration 0279 — Site Damage Settlement + Mine Rehabilitation (mining).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Ported from the BossNyumba dispute / damage-deduction + conditional-survey
-- stack, retargeted real-estate → mining. BN settled a TENANT damage
-- deduction against a lease deposit and approved a remediation action plan
-- off a conditional survey. Borjie has no equivalent: there was NO
-- contractor / site damage-claim settlement surface and NO mine-rehabilitation
-- plan approval surface. This migration is the data layer for that vertical
-- slice:
--
--   contractor_damage_claims    — a claim the licence holder files against a
--                                 contractor / counterparty for damage caused
--                                 to a site (equipment, haul road, env
--                                 buffer, water source). Negotiated to an
--                                 agreed amount, then settled. The RE
--                                 `tenant damage deduction` → mining
--                                 `contractor/site damage claim`.
--
--   site_rehabilitation_plans   — a mine-rehabilitation plan tied to a site
--                                 (post-extraction backfill, re-vegetation,
--                                 water treatment). The RE `conditional
--                                 survey` → mining `rehabilitation plan`.
--
--   rehabilitation_action_plans — one proposed remediation action under a
--                                 rehabilitation plan. The owner approves an
--                                 action plan to unblock the downstream
--                                 work-order dispatch. The RE
--                                 `conditional-survey action plan` →
--                                 mining `rehabilitation action plan`.
--
-- FLOW (mirrors BN settle / respond / approve_plan):
--   site.damage_claim.respond  → owner records a counter-proposal / rationale
--                                 on an OPEN claim (claim_filed | negotiating).
--   site.damage_claim.settle   → owner agrees + finalises an agreed amount;
--                                 the claim moves to `agreed`. HIGH stakes.
--   site.rehabilitation.approve_plan
--                              → owner green-lights a proposed action plan;
--                                 it moves to `approved`, unblocking dispatch.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule):
--   Amounts are stored in MINOR units (`*_minor` bigint) plus a 3-letter
--   `currency` code. There is NO default currency — the route resolves the
--   tenant currency before insert. NEVER hard-code TZS/KES/UGX/NGN. NO money
--   moves here: settlement records the agreed amount as STATE only; any ledger
--   posting is a separate LedgerService step (honest-degrade — we never
--   fabricate a ledger write that does not exist).
--
-- FRESH-DB SAFETY / IDEMPOTENCY
-- -----------------------------
-- Every statement is guarded: CREATE TABLE IF NOT EXISTS, DO-blocks that check
-- pg_constraint / pg_policies before ADD CONSTRAINT / CREATE POLICY, CREATE
-- INDEX IF NOT EXISTS, and a pg_roles guard around the anon REVOKE. On a
-- fully-migrated DB this is a pure no-op; on a FRESH or partially-applied DB
-- it stands the tables up correctly secured. FK targets (sites, external_
-- parties) are pre-existing (migrations 0093 / sites foundation); the FK is
-- declared inline so a claim cannot point at a non-existent site / contractor.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped tables -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (the canonical GUC the
--     api-gateway databaseMiddleware binds; migration 0172 unified the helper
--     on this name). NEVER the legacy app.tenant_id.
--   * REVOKE anon, guarded for vanilla Postgres / CI empty-PG (anon is a
--     Supabase-only role).
--   * Migrations are immutable + forward-only: this APPENDS a new numbered
--     file (next after 0278); it edits no shipped migration. Safe to re-run.
--   * Amounts in minor units + explicit currency. NO money default.
--
-- Companion files:
--   - packages/database/src/migrations/down/0279_down_site_damage_settlement.sql
--   - packages/database/src/schemas/site-damage-settlement.schema.ts
--   - services/api-gateway/src/routes/damage-claims.hono.ts
--   - services/api-gateway/src/composition/damage-claim-repository.ts
--   - services/api-gateway/src/composition/brain-tools/damage-settlement-tools.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- §1 — contractor_damage_claims.
--
-- A claim the licence holder files against a contractor / counterparty for
-- damage caused to a site. Negotiated (respond) then settled (settle). The
-- agreed amount is recorded as STATE; no ledger posting fires here.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contractor_damage_claims (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  text        NOT NULL,
  -- The site the damage occurred at (hard FK — a claim cannot float free).
  site_id                    text        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  -- The contractor / counterparty the claim is against (hard FK to the
  -- counterparty registry). The route validates BOTH this and site_id before
  -- respond / settle.
  contractor_party_id        uuid        NOT NULL REFERENCES external_parties(id) ON DELETE CASCADE,
  -- Optional link to the inspection / engagement that surfaced the damage.
  source_engagement_id       uuid,
  -- What was damaged: equipment | haul_road | env_buffer | water_source |
  -- processing_plant | camp | other.
  damage_category            text        NOT NULL DEFAULT 'other',
  -- Amounts in MINOR units; currency is explicit (NO default).
  claimed_amount_minor       bigint      NOT NULL,
  counter_proposal_minor     bigint,
  agreed_amount_minor        bigint,
  currency                   text        NOT NULL,
  -- Lifecycle: claim_filed -> negotiating -> agreed | withdrawn.
  status                     text        NOT NULL DEFAULT 'claim_filed',
  rationale                  text        NOT NULL,
  notes                      text,
  -- Append-only negotiation turns (owner / contractor / rationale snapshots).
  negotiation_turns          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Provenance envelope (via: 'chat' | 'form' | 'api') — shape-stable with the
  -- brain-tool withChatProvenance helper so the "via Mr. Mwikila" pill works.
  provenance                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Soft reference to ai_audit_chain — pinned at each WRITE by the route.
  audit_chain_ids            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by                 text,
  updated_by                 text,
  settled_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- §2 — site_rehabilitation_plans.
--
-- A mine-rehabilitation plan tied to a site. Holds many action plans. The RE
-- conditional survey → mining rehabilitation plan.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_rehabilitation_plans (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  site_id             text        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title               text        NOT NULL,
  summary             text,
  -- backfill | re_vegetation | water_treatment | slope_stabilisation |
  -- waste_dump_capping | general.
  scope               text        NOT NULL DEFAULT 'general',
  -- draft -> in_review -> compiled -> closed.
  status              text        NOT NULL DEFAULT 'draft',
  scheduled_at        timestamptz,
  provenance          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  audit_chain_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by          text,
  updated_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- §3 — rehabilitation_action_plans.
--
-- One proposed remediation action under a rehabilitation plan. The owner
-- approves an action plan (approve_plan) to unblock the downstream work-order
-- dispatch.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rehabilitation_action_plans (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text        NOT NULL,
  rehabilitation_plan_id   uuid        NOT NULL REFERENCES site_rehabilitation_plans(id) ON DELETE CASCADE,
  title                    text        NOT NULL,
  description              text,
  -- low | medium | high | critical.
  severity                 text        NOT NULL DEFAULT 'medium',
  -- Estimated remediation cost in MINOR units; currency explicit, nullable
  -- (an action plan may be approved before a cost estimate lands).
  estimated_cost_minor     bigint,
  currency                 text,
  -- proposed -> approved -> rejected -> dispatched.
  status                   text        NOT NULL DEFAULT 'proposed',
  approved_by              text,
  approved_at              timestamptz,
  provenance               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  audit_chain_ids          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- §4 — CHECK constraints (guarded so a re-run never errors).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cdc_status_chk'
  ) THEN
    ALTER TABLE contractor_damage_claims
      ADD CONSTRAINT cdc_status_chk
      CHECK (status IN ('claim_filed', 'negotiating', 'agreed', 'withdrawn'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cdc_category_chk'
  ) THEN
    ALTER TABLE contractor_damage_claims
      ADD CONSTRAINT cdc_category_chk
      CHECK (damage_category IN (
        'equipment', 'haul_road', 'env_buffer', 'water_source',
        'processing_plant', 'camp', 'other'
      ));
  END IF;

  -- Amounts are non-negative when present (defense in depth; zod also guards).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cdc_amounts_nonneg_chk'
  ) THEN
    ALTER TABLE contractor_damage_claims
      ADD CONSTRAINT cdc_amounts_nonneg_chk
      CHECK (
        claimed_amount_minor >= 0
        AND (counter_proposal_minor IS NULL OR counter_proposal_minor >= 0)
        AND (agreed_amount_minor IS NULL OR agreed_amount_minor >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'srp_status_chk'
  ) THEN
    ALTER TABLE site_rehabilitation_plans
      ADD CONSTRAINT srp_status_chk
      CHECK (status IN ('draft', 'in_review', 'compiled', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'srp_scope_chk'
  ) THEN
    ALTER TABLE site_rehabilitation_plans
      ADD CONSTRAINT srp_scope_chk
      CHECK (scope IN (
        'backfill', 're_vegetation', 'water_treatment',
        'slope_stabilisation', 'waste_dump_capping', 'general'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rap_status_chk'
  ) THEN
    ALTER TABLE rehabilitation_action_plans
      ADD CONSTRAINT rap_status_chk
      CHECK (status IN ('proposed', 'approved', 'rejected', 'dispatched'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rap_severity_chk'
  ) THEN
    ALTER TABLE rehabilitation_action_plans
      ADD CONSTRAINT rap_severity_chk
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §5 — indexes (IF NOT EXISTS keeps every one a no-op on re-run).
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS cdc_tenant_status_idx
  ON contractor_damage_claims (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cdc_site_idx
  ON contractor_damage_claims (site_id);
CREATE INDEX IF NOT EXISTS cdc_contractor_idx
  ON contractor_damage_claims (contractor_party_id);

CREATE INDEX IF NOT EXISTS srp_tenant_status_idx
  ON site_rehabilitation_plans (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS srp_site_idx
  ON site_rehabilitation_plans (site_id);

CREATE INDEX IF NOT EXISTS rap_plan_idx
  ON rehabilitation_action_plans (rehabilitation_plan_id);
CREATE INDEX IF NOT EXISTS rap_tenant_status_idx
  ON rehabilitation_action_plans (tenant_id, status, created_at DESC);

-- -----------------------------------------------------------------------------
-- §6 — FORCE RLS + tenant-isolation policies on the CANONICAL GUC.
--
-- tenant_id is TEXT so the compare is bare (no cast). FOR ALL covers INSERT,
-- the respond / settle / approve UPDATE, and the list / read SELECT.
-- Idempotent: ENABLE / FORCE are no-ops if already set; each policy is created
-- only if absent. Defense in depth: the route's authMiddleware +
-- databaseMiddleware bind the GUC and refuse unauthenticated calls BEFORE the
-- policy is evaluated.
-- -----------------------------------------------------------------------------

ALTER TABLE contractor_damage_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_damage_claims    FORCE  ROW LEVEL SECURITY;
ALTER TABLE site_rehabilitation_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_rehabilitation_plans   FORCE  ROW LEVEL SECURITY;
ALTER TABLE rehabilitation_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehabilitation_action_plans FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'contractor_damage_claims'
       AND policyname = 'cdc_tenant_isolation'
  ) THEN
    CREATE POLICY cdc_tenant_isolation
      ON contractor_damage_claims
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'site_rehabilitation_plans'
       AND policyname = 'srp_tenant_isolation'
  ) THEN
    CREATE POLICY srp_tenant_isolation
      ON site_rehabilitation_plans
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'rehabilitation_action_plans'
       AND policyname = 'rap_tenant_isolation'
  ) THEN
    CREATE POLICY rap_tenant_isolation
      ON rehabilitation_action_plans
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- anon is a Supabase construct; guard so the migration still applies on a
-- vanilla Postgres (CI empty-PG check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.contractor_damage_claims FROM anon;';
    EXECUTE 'REVOKE ALL ON public.site_rehabilitation_plans FROM anon;';
    EXECUTE 'REVOKE ALL ON public.rehabilitation_action_plans FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE contractor_damage_claims IS
  'Contractor / site damage-claim settlement (migration 0279; ported from the '
  'BN damage-deduction stack, retargeted real-estate -> mining). The licence '
  'holder files a claim against a contractor for site damage, negotiates '
  '(respond), then settles (settle) at an agreed amount recorded as STATE — '
  'NO ledger posting fires here. Amounts in minor units + explicit currency. '
  'Tenant-scoped FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE site_rehabilitation_plans IS
  'Mine-rehabilitation plan (migration 0279; RE conditional-survey -> mining '
  'rehabilitation plan). Holds many rehabilitation_action_plans. Tenant-scoped '
  'FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMENT ON TABLE rehabilitation_action_plans IS
  'Rehabilitation action plan (migration 0279; RE conditional-survey action '
  'plan -> mining rehabilitation action plan). Approving an action plan '
  '(approve_plan) unblocks the downstream work-order dispatch. Tenant-scoped '
  'FORCE RLS on the canonical app.current_tenant_id GUC.';

COMMIT;
