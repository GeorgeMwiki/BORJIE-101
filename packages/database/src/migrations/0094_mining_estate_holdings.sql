-- =============================================================================
-- Migration 0094 — Mining Estate Holdings
--
-- Wave: ESTATE-OS. Borjie is the family-office chief of staff for a
-- mining-rooted business empire. This migration lands the five tables
-- the estate domain needs:
--
--   estate_groups            top-level holding registry
--   estate_entities          each subsidiary / JV / asset under a group
--   estate_capital_movements view-layer ledger of intercompany flows
--   succession_plans         successor designation + review cadence
--   estate_assets            asset register linked to each entity
--
-- IMPORTANT: estate_capital_movements is a VIEW LAYER over the canonical
-- ledger (LedgerService.post). Money still posts through the ledger; this
-- table only stores the narrative + intercompany metadata. The brain
-- tool `intercompany_flow_query` aggregates from this table and joins
-- back to the ledger when the caller needs balance data.
--
-- Companion to:
--   - packages/database/src/schemas/estate-*.schema.ts
--   - services/api-gateway/src/routes/estate/*.hono.ts
--   - apps/owner-web/src/app/(routes)/estate/{,entities,capital-movements,
--     succession,assets}/page.tsx
--
-- INVARIANTS
--   - RLS FORCE on every table.
--   - Hash-chain audit on every state change (audit_hash_id linked).
--   - Idempotent — safe to re-run.
--   - Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) estate_groups — top-level family-office groups.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estate_groups (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  name                    text        NOT NULL,
  holding_type            text        NOT NULL,
  country                 text        NOT NULL DEFAULT 'TZ',
  principal_owner_name    text        NOT NULL,
  principal_owner_nida    text,
  principal_owner_tin     text,
  founding_year           integer,
  succession_doc_id       text,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_groups_holding_type_chk'
  ) THEN
    ALTER TABLE estate_groups
      ADD CONSTRAINT estate_groups_holding_type_chk
      CHECK (holding_type IN (
        'family_trust', 'family_office', 'holding_company',
        'cooperative', 'investment_vehicle', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estate_groups_tenant_created
  ON estate_groups (tenant_id, created_at DESC);

ALTER TABLE estate_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_groups FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'estate_groups'
       AND policyname = 'estate_groups_tenant_isolation'
  ) THEN
    CREATE POLICY estate_groups_tenant_isolation
      ON estate_groups
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) estate_entities — each subsidiary / JV / standalone holding.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estate_entities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  estate_group_id   uuid        NOT NULL REFERENCES estate_groups(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  kind              text        NOT NULL,
  brela_no          text,
  tin               text,
  ownership_pct     numeric(5,2) NOT NULL DEFAULT 100,
  parent_entity_id  uuid        REFERENCES estate_entities(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'active',
  founded_at        date,
  divested_at       date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_entities_kind_chk'
  ) THEN
    ALTER TABLE estate_entities
      ADD CONSTRAINT estate_entities_kind_chk
      CHECK (kind IN (
        'mine_licence_holder', 'processing_plant', 'transport_co',
        'equipment_rental', 'camp_catering', 'fuel_station',
        'retail_at_site', 'real_estate', 'agriculture', 'forestry',
        'tourism', 'security_co', 'insurance_brokerage', 'consulting_firm',
        'training_school', 'subsidiary_holding', 'joint_venture', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_entities_status_chk'
  ) THEN
    ALTER TABLE estate_entities
      ADD CONSTRAINT estate_entities_status_chk
      CHECK (status IN ('active', 'dormant', 'divested', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estate_entities_tenant_group
  ON estate_entities (tenant_id, estate_group_id, status);

CREATE INDEX IF NOT EXISTS idx_estate_entities_parent
  ON estate_entities (parent_entity_id);

ALTER TABLE estate_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_entities FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'estate_entities'
       AND policyname = 'estate_entities_tenant_isolation'
  ) THEN
    CREATE POLICY estate_entities_tenant_isolation
      ON estate_entities
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) estate_capital_movements — view-layer ledger of intercompany flows.
--    The actual money STILL goes through LedgerService.post(). This table
--    stores the narrative + intercompany metadata; readers join back to
--    the canonical ledger when balance data is needed.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estate_capital_movements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  from_entity_id  uuid        REFERENCES estate_entities(id),
  to_entity_id    uuid        REFERENCES estate_entities(id),
  kind            text        NOT NULL,
  amount          numeric(18,2) NOT NULL,
  currency        text        NOT NULL DEFAULT 'TZS',
  happened_at     timestamptz NOT NULL DEFAULT now(),
  narrative       text,
  doc_link_id     text,
  ledger_entry_id text,
  audit_hash_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ecm_kind_chk'
  ) THEN
    ALTER TABLE estate_capital_movements
      ADD CONSTRAINT ecm_kind_chk
      CHECK (kind IN (
        'capital_injection', 'dividend', 'loan', 'loan_repayment',
        'transfer', 'expense_reimbursement', 'asset_purchase',
        'asset_sale', 'royalty', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ecm_tenant_happened
  ON estate_capital_movements (tenant_id, happened_at DESC);

CREATE INDEX IF NOT EXISTS idx_ecm_from_entity
  ON estate_capital_movements (tenant_id, from_entity_id, happened_at DESC);

CREATE INDEX IF NOT EXISTS idx_ecm_to_entity
  ON estate_capital_movements (tenant_id, to_entity_id, happened_at DESC);

ALTER TABLE estate_capital_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_capital_movements FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'estate_capital_movements'
       AND policyname = 'ecm_tenant_isolation'
  ) THEN
    CREATE POLICY ecm_tenant_isolation
      ON estate_capital_movements
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) succession_plans — successor designation + review cadence.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS succession_plans (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       text        NOT NULL,
  estate_group_id                 uuid        NOT NULL REFERENCES estate_groups(id) ON DELETE CASCADE,
  current_principal_name          text        NOT NULL,
  designated_successor_name       text        NOT NULL,
  designated_successor_relation   text        NOT NULL,
  designated_successor_nida       text,
  contingency_successor_name      text,
  will_doc_id                     text,
  last_review_at                  timestamptz NOT NULL DEFAULT now(),
  next_review_due_at              timestamptz NOT NULL,
  status                          text        NOT NULL DEFAULT 'current',
  notes                           text,
  audit_hash_id                   uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sp_status_chk'
  ) THEN
    ALTER TABLE succession_plans
      ADD CONSTRAINT sp_status_chk
      CHECK (status IN ('current', 'pending_review', 'overdue', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sp_tenant_group
  ON succession_plans (tenant_id, estate_group_id);

CREATE INDEX IF NOT EXISTS idx_sp_next_review
  ON succession_plans (tenant_id, next_review_due_at);

ALTER TABLE succession_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE succession_plans FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'succession_plans'
       AND policyname = 'sp_tenant_isolation'
  ) THEN
    CREATE POLICY sp_tenant_isolation
      ON succession_plans
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) estate_assets — asset register per entity.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estate_assets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  estate_entity_id    uuid        NOT NULL REFERENCES estate_entities(id) ON DELETE CASCADE,
  asset_class         text        NOT NULL,
  descriptor          text        NOT NULL,
  acquired_at         date,
  acquired_cost_tzs   numeric(18,2),
  current_value_tzs   numeric(18,2) NOT NULL DEFAULT 0,
  valuation_method    text        NOT NULL DEFAULT 'book_value',
  valuation_at        timestamptz NOT NULL DEFAULT now(),
  location            text,
  insured_until       date,
  encumbrances        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_assets_class_chk'
  ) THEN
    ALTER TABLE estate_assets
      ADD CONSTRAINT estate_assets_class_chk
      CHECK (asset_class IN (
        'mining_equipment', 'vehicle', 'real_estate', 'building',
        'mineral_inventory', 'financial_instrument', 'land',
        'intellectual_property', 'cash_equivalent', 'investment', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_assets_valmethod_chk'
  ) THEN
    ALTER TABLE estate_assets
      ADD CONSTRAINT estate_assets_valmethod_chk
      CHECK (valuation_method IN (
        'book_value', 'market_value', 'replacement_cost',
        'appraised', 'discounted_cash_flow', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estate_assets_tenant_entity
  ON estate_assets (tenant_id, estate_entity_id, asset_class);

ALTER TABLE estate_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_assets FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'estate_assets'
       AND policyname = 'estate_assets_tenant_isolation'
  ) THEN
    CREATE POLICY estate_assets_tenant_isolation
      ON estate_assets
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
