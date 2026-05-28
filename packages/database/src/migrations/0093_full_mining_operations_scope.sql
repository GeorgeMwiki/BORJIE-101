-- =============================================================================
-- Migration 0093 — Full Mining Operations Scope
--
-- Wave: OPS-WIDE. Borjie runs the ENTIRE mining operation — not just
-- on-mine work. This migration lands the four supporting tables for
-- the upstream (licensing/survey/prospecting), downstream
-- (transport/processors/smelters/refiners/assayers/exporters/banks/LBMA),
-- and adjacent (logistics/CSR/env-monitor/gov-liaison/legal/regulator/
-- insurance/security) layers.
--
-- Companion to:
--   - packages/database/src/schemas/external-parties.schema.ts
--   - packages/database/src/schemas/external-party-engagements.schema.ts
--   - packages/database/src/schemas/mineral-chain-of-custody.schema.ts
--   - packages/database/src/schemas/regulatory-filings.schema.ts
--   - services/api-gateway/src/routes/ops/external-parties.hono.ts
--   - services/api-gateway/src/routes/ops/engagements.hono.ts
--   - services/api-gateway/src/routes/ops/chain-of-custody.hono.ts
--   - services/api-gateway/src/routes/ops/regulatory-filings.hono.ts
--   - apps/owner-web/src/lib/queries/ops.ts
--
-- INVARIANTS
--   - RLS FORCE on every tenant-scoped table.
--   - Hash-chained chain of custody (audit_hash_id references ai_audit_chain).
--   - Idempotent — safe to re-run.
--   - Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) external_parties — every off-mine counterparty.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_parties (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL,
  party_type         text        NOT NULL,
  name               text        NOT NULL,
  tin                text,
  brela_no           text,
  country            text        NOT NULL DEFAULT 'TZ',
  region             text,
  primary_contact    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  payment_terms      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  scorecard_score    numeric(4,2) NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'active',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_parties_party_type_chk'
  ) THEN
    ALTER TABLE external_parties
      ADD CONSTRAINT external_parties_party_type_chk
      CHECK (party_type IN (
        'licensing_office', 'survey_firm', 'transport_co', 'processor',
        'smelter', 'refiner', 'assayer', 'exporter', 'bank', 'regulator',
        'off_taker', 'logistics_co', 'csr_community', 'env_monitor',
        'gov_liaison', 'legal_counsel', 'insurance', 'security_firm'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_parties_status_chk'
  ) THEN
    ALTER TABLE external_parties
      ADD CONSTRAINT external_parties_status_chk
      CHECK (status IN ('active', 'inactive', 'blocked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_external_parties_tenant_type
  ON external_parties (tenant_id, party_type, status);

CREATE INDEX IF NOT EXISTS idx_external_parties_tenant_name
  ON external_parties (tenant_id, name);

ALTER TABLE external_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_parties FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'external_parties'
       AND policyname = 'external_parties_tenant_isolation'
  ) THEN
    CREATE POLICY external_parties_tenant_isolation
      ON external_parties
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) external_party_engagements — timeline of interactions per party.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_party_engagements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  party_id      uuid        NOT NULL REFERENCES external_parties(id) ON DELETE CASCADE,
  site_id       text,
  kind          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'open',
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  summary       text        NOT NULL,
  doc_links     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  audit_hash_id uuid,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epe_kind_chk'
  ) THEN
    ALTER TABLE external_party_engagements
      ADD CONSTRAINT epe_kind_chk
      CHECK (kind IN (
        'meeting', 'inspection', 'shipment', 'payment', 'application',
        'dispute', 'community_event', 'audit', 'site_visit', 'document_request',
        'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epe_status_chk'
  ) THEN
    ALTER TABLE external_party_engagements
      ADD CONSTRAINT epe_status_chk
      CHECK (status IN ('open', 'in_progress', 'closed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_epe_party_opened
  ON external_party_engagements (party_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_epe_tenant_status
  ON external_party_engagements (tenant_id, status, opened_at DESC);

ALTER TABLE external_party_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_party_engagements FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'external_party_engagements'
       AND policyname = 'epe_tenant_isolation'
  ) THEN
    CREATE POLICY epe_tenant_isolation
      ON external_party_engagements
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) mineral_chain_of_custody — hash-chained pit-to-buyer steps.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mineral_chain_of_custody (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL,
  parcel_id          text        NOT NULL,
  step_index         integer     NOT NULL,
  from_party_id      uuid        REFERENCES external_parties(id),
  to_party_id        uuid        NOT NULL REFERENCES external_parties(id),
  action             text        NOT NULL,
  happened_at        timestamptz NOT NULL DEFAULT now(),
  weight_grams       numeric(20,3),
  grade_pct          numeric(7,4),
  container_seal_no  text,
  location           text,
  audit_hash_id      uuid        NOT NULL,
  prev_audit_hash    text        NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cco_action_chk'
  ) THEN
    ALTER TABLE mineral_chain_of_custody
      ADD CONSTRAINT cco_action_chk
      CHECK (action IN (
        'extract', 'transport', 'process', 'smelt', 'refine', 'assay',
        'export', 'sell', 'store', 'transfer', 'split', 'merge'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cco_uniq_parcel_step'
  ) THEN
    ALTER TABLE mineral_chain_of_custody
      ADD CONSTRAINT cco_uniq_parcel_step
      UNIQUE (tenant_id, parcel_id, step_index);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cco_tenant_parcel
  ON mineral_chain_of_custody (tenant_id, parcel_id, step_index);

ALTER TABLE mineral_chain_of_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE mineral_chain_of_custody FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mineral_chain_of_custody'
       AND policyname = 'cco_tenant_isolation'
  ) THEN
    CREATE POLICY cco_tenant_isolation
      ON mineral_chain_of_custody
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) regulatory_filings — calendar of obligations.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regulatory_filings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  regulator       text        NOT NULL,
  filing_type     text        NOT NULL,
  due_at          timestamptz NOT NULL,
  submitted_at    timestamptz,
  status          text        NOT NULL DEFAULT 'upcoming',
  reference_no    text,
  payload_doc_id  text,
  decided_at      timestamptz,
  decided_outcome text,
  fee_paid_tzs    numeric(18,2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rf_regulator_chk'
  ) THEN
    ALTER TABLE regulatory_filings
      ADD CONSTRAINT rf_regulator_chk
      CHECK (regulator IN (
        'mining_commission', 'tra', 'nemc', 'bot', 'tcra', 'osha', 'ica',
        'lbma', 'tbs', 'tphpa', 'tlb', 'pra', 'customs', 'brela', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rf_status_chk'
  ) THEN
    ALTER TABLE regulatory_filings
      ADD CONSTRAINT rf_status_chk
      CHECK (status IN (
        'upcoming', 'in_progress', 'submitted', 'approved', 'rejected',
        'overdue', 'cancelled'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rf_tenant_due
  ON regulatory_filings (tenant_id, due_at, status);

CREATE INDEX IF NOT EXISTS idx_rf_tenant_regulator
  ON regulatory_filings (tenant_id, regulator, status);

ALTER TABLE regulatory_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_filings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'regulatory_filings'
       AND policyname = 'rf_tenant_isolation'
  ) THEN
    CREATE POLICY rf_tenant_isolation
      ON regulatory_filings
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
