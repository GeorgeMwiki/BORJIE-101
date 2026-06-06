-- =============================================================================
-- Migration 0295 — stage_advisor (stage-aware capability advisor durable store).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/stage-advisor` (createStageAdvisor) classifies an org into one of
-- seven lifecycle stages (pre-launch → ecosystem) keyed off `unitsManaged`,
-- with HYSTERESIS so a portfolio that briefly dips below a threshold is not
-- flapped down-then-up. It surfaces the active stage card, an onboarding
-- playbook, capability gating, and proactive nudges over `/api/v1/stage`.
--
-- Until now the package shipped only an in-memory `StageAdvisorDb` port
-- (`createInMemoryStageAdvisorDb`), so the gateway had nothing durable to bind
-- and the route returned 503 SERVICE_UNAVAILABLE. This migration stands up the
-- REAL tables the Drizzle `StageAdvisorDb` adapter reads/writes so the route
-- resolves a live `services.stageAdvisor`.
--
-- TABLES (each maps 1:1 to a method on the package `StageAdvisorDb` port):
--   * stage_advisor_metrics          — latest org-metrics snapshot per tenant
--                                      (getMetrics). Primary axis unitsManaged
--                                      + secondaries (activeUsers, revenue,
--                                      ageMonths, regionCount, churn).
--   * stage_advisor_org_state        — latest org operational-state snapshot
--                                      per tenant (getOrgState) — drives
--                                      playbook task-completion predicates.
--   * stage_advisor_state            — persisted hysteresis state per tenant
--                                      (getPersistedState / savePersistedState):
--                                      current stage + since, candidate + since.
--   * stage_advisor_nudges           — append-only nudge-delivery log per tenant
--                                      (getNudgeHistory / recordNudgeDelivery)
--                                      backing the lookback-window idempotency.
--   * stage_advisor_nudge_dismissals — sticky per-(tenant,nudge) dismissals
--                                      (isNudgeDismissed / dismissNudge); a row
--                                      here suppresses the nudge permanently.
--   * stage_advisor_transitions      — append-only stage-transition history per
--                                      tenant (getTransitionHistory /
--                                      appendTransition) backing GET /history.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0292 / 0294):
--   tenant_id is TEXT and FK→tenants; every table FORCE-enables ROW LEVEL
--   SECURITY with a tenant policy on the canonical `app.current_tenant_id` GUC
--   (the GUC the api-gateway databaseMiddleware binds). The compare is bare
--   (no cast) because tenant_id is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): the only money column is
-- `monthly_revenue_cents` — an INTEGER minor-units figure carried alongside a
-- free-text `currency` code resolved per-tenant. NO currency literal
-- (TZS/USD/…) appears anywhere.
--
-- APPEND-ONLY DISCIPLINE: stage_advisor_nudges + stage_advisor_transitions are
-- event logs. The Drizzle adapter only ever INSERTs into them; history is never
-- mutated (matches the package's immutable `NudgeDeliveryRecord` /
-- `StageTransition`). stage_advisor_metrics / _org_state / _state are
-- last-write-wins snapshots (one row per tenant) upserted on conflict.
--
-- ID DISCIPLINE: snapshot tables are keyed by `tenant_id` (one row/tenant).
-- The two append-only logs use a uuid surrogate `id` default — the package
-- carries no id for delivery/transition records so we generate one here.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_policies checks) / CREATE INDEX IF NOT EXISTS, and a pg_roles
-- guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
-- References only pre-existing infra (`tenants`).
--
-- Companion files:
--   * packages/database/src/schemas/stage-advisor.schema.ts
--   * services/api-gateway/src/composition/stage/drizzle-stage-advisor-db.ts
--   * services/api-gateway/src/routes/stage/index.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- stage_advisor_metrics — latest org-metrics snapshot (one row per tenant).
-- Read by getMetrics(); the detector's primary signal is unitsManaged.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_metrics (
  tenant_id              text        PRIMARY KEY
                                     REFERENCES tenants(id) ON DELETE CASCADE,
  -- Primary axis — total units the org manages.
  units_managed          integer     NOT NULL DEFAULT 0,
  active_users           integer     NOT NULL DEFAULT 0,
  -- Monthly revenue in INTEGER minor-units of the tenant reporting currency.
  monthly_revenue_cents  integer     NOT NULL DEFAULT 0,
  -- ISO-4217 reporting currency (resolved per-tenant; no literal in code).
  currency               text        NOT NULL DEFAULT 'TZS',
  -- Months since the org's first property/site was created.
  age_months             integer     NOT NULL DEFAULT 0,
  -- Distinct geographic regions the org operates in.
  region_count           integer     NOT NULL DEFAULT 0,
  -- Rolling 90d churn rate (0-1) stored as a double.
  tenant_churn_rate      double precision NOT NULL DEFAULT 0,
  -- Observation timestamp the smoothing window measures against.
  observed_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- stage_advisor_org_state — latest operational-state snapshot (one per tenant).
-- Read by getOrgState(); drives playbook task-completion predicates.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_org_state (
  tenant_id                       text    PRIMARY KEY
                                          REFERENCES tenants(id) ON DELETE CASCADE,
  org_setup_complete              boolean NOT NULL DEFAULT false,
  property_count                  integer NOT NULL DEFAULT 0,
  units_managed                   integer NOT NULL DEFAULT 0,
  lease_count                     integer NOT NULL DEFAULT 0,
  payment_methods_configured      integer NOT NULL DEFAULT 0,
  maintenance_categories_defined  integer NOT NULL DEFAULT 0,
  scheduled_inspections_configured integer NOT NULL DEFAULT 0,
  vendor_count                    integer NOT NULL DEFAULT 0,
  inventory_locations_count       integer NOT NULL DEFAULT 0,
  rfq_count                       integer NOT NULL DEFAULT 0,
  fleet_vehicle_count             integer NOT NULL DEFAULT 0,
  report_cadence_count            integer NOT NULL DEFAULT 0,
  regions_configured              integer NOT NULL DEFAULT 0,
  treasury_account_count          integer NOT NULL DEFAULT 0,
  jurisdictions_configured        integer NOT NULL DEFAULT 0,
  -- Extension bag for extra named signals (string|number|boolean values).
  extra                           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- stage_advisor_state — persisted hysteresis state (one row per tenant).
-- Read/written by getPersistedState() / savePersistedState().
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_state (
  tenant_id              text        PRIMARY KEY
                                     REFERENCES tenants(id) ON DELETE CASCADE,
  -- One of: pre-launch|seedling|sprout|sapling|tree|forest|ecosystem.
  current_stage          text        NOT NULL,
  current_stage_since    timestamptz NOT NULL,
  -- Candidate stage under observation (NULL when none pending).
  candidate_stage        text,
  candidate_stage_since  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- stage_advisor_nudges — append-only nudge-delivery log (idempotency history).
-- Read by getNudgeHistory(); appended by recordNudgeDelivery().
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_nudges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stable nudge id (`stage-nudge:<tenant>:<topic>`) — what idempotency keys on.
  nudge_id      text        NOT NULL,
  delivered_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stage_advisor_nudges_tenant_idx
  ON stage_advisor_nudges (tenant_id);

CREATE INDEX IF NOT EXISTS stage_advisor_nudges_tenant_nudge_idx
  ON stage_advisor_nudges (tenant_id, nudge_id);

CREATE INDEX IF NOT EXISTS stage_advisor_nudges_tenant_delivered_idx
  ON stage_advisor_nudges (tenant_id, delivered_at);

-- -----------------------------------------------------------------------------
-- stage_advisor_nudge_dismissals — sticky per-(tenant,nudge) suppression set.
-- Read by isNudgeDismissed(); upserted by dismissNudge().
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_nudge_dismissals (
  tenant_id     text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nudge_id      text        NOT NULL,
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, nudge_id)
);

-- -----------------------------------------------------------------------------
-- stage_advisor_transitions — append-only stage-transition history.
-- Read by getTransitionHistory(); appended by appendTransition().
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_advisor_transitions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_stage               text        NOT NULL,
  to_stage                 text        NOT NULL,
  -- grow|shrink|same.
  kind                     text        NOT NULL,
  introduction_message     text        NOT NULL DEFAULT '',
  recommended_next_steps   text[]      NOT NULL DEFAULT '{}',
  capabilities_to_unlock   text[]      NOT NULL DEFAULT '{}',
  capabilities_to_review   text[]      NOT NULL DEFAULT '{}',
  occurred_at              timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stage_advisor_transitions_tenant_idx
  ON stage_advisor_transitions (tenant_id);

CREATE INDEX IF NOT EXISTS stage_advisor_transitions_tenant_occurred_idx
  ON stage_advisor_transitions (tenant_id, occurred_at);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (FORCE so the owner role
-- cannot bypass it either).
-- -----------------------------------------------------------------------------

ALTER TABLE stage_advisor_metrics           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_metrics           FORCE  ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_org_state         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_org_state         FORCE  ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_state             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_state             FORCE  ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_nudges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_nudges            FORCE  ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_nudge_dismissals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_nudge_dismissals  FORCE  ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_transitions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_advisor_transitions       FORCE  ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stage_advisor_metrics',
    'stage_advisor_org_state',
    'stage_advisor_state',
    'stage_advisor_nudges',
    'stage_advisor_nudge_dismissals',
    'stage_advisor_transitions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = t
         AND policyname = t || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        t || '_tenant_isolation',
        t
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.stage_advisor_metrics FROM anon;';
    EXECUTE 'REVOKE ALL ON public.stage_advisor_org_state FROM anon;';
    EXECUTE 'REVOKE ALL ON public.stage_advisor_state FROM anon;';
    EXECUTE 'REVOKE ALL ON public.stage_advisor_nudges FROM anon;';
    EXECUTE 'REVOKE ALL ON public.stage_advisor_nudge_dismissals FROM anon;';
    EXECUTE 'REVOKE ALL ON public.stage_advisor_transitions FROM anon;';
  END IF;
END $$;

COMMIT;
