-- ============================================================================
-- Migration 0169 — Outcomes metering store.
--
-- Backs `services/outcomes-metering`. Two tables:
--
--   * `outcome_events`         — append-only record of every OutcomeEvent
--                                the brain-event-bus relayed. One row per
--                                event_id (UNIQUE — idempotency on retry).
--   * `outcome_billing_lines`  — one row per qualified MeteringRecord
--                                emitted by the pure scorers in
--                                `@borjie/outcomes`. The billing
--                                engine aggregates monthly slices.
--
-- Multi-tenant isolation: tenant_id is mandatory at the adapter layer.
-- The existing RLS migration 0155 covers any new tables that follow the
-- `tenant_id` convention.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS. UNIQUE on
-- (tenant_id, event_id) so re-delivery of the same brain event lands a
-- single billing line at most.
--
-- Backwards-compatible: no destructive ALTERs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS outcome_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  /** Caller-supplied stable id. Idempotency anchor. */
  event_id            TEXT NOT NULL,
  /** OutcomeKind: 'ticket_resolved_within_sla' | 'rent_collected' | 'vacancy_filled' */
  outcome_kind        TEXT NOT NULL,
  property_id         TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  /** Wall-clock when the agent claims the outcome occurred. */
  occurred_at_iso     TEXT NOT NULL,
  /** Raw OutcomeEvent payload (discriminated by `kind`). */
  payload             JSONB NOT NULL,
  /** Source brain event type for audit (e.g. `lease.signed`). */
  source_event_type   TEXT NOT NULL,
  /** Acceptance timestamp at the consumer. */
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outcome_events_kind_chk
    CHECK (outcome_kind IN ('ticket_resolved_within_sla', 'rent_collected', 'vacancy_filled'))
);

-- Idempotency: one event_id per tenant lands once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outcome_events_tenant_event
  ON outcome_events (tenant_id, event_id);

CREATE INDEX IF NOT EXISTS idx_outcome_events_tenant_kind
  ON outcome_events (tenant_id, outcome_kind);

CREATE INDEX IF NOT EXISTS idx_outcome_events_received
  ON outcome_events (received_at DESC);

-- ============================================================================
-- Billing lines — one per qualified MeteringRecord.
-- ============================================================================

CREATE TABLE IF NOT EXISTS outcome_billing_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT NOT NULL,
  /** UUID/ULID handed to the scorer (1:1 with billing identity). */
  record_id                TEXT NOT NULL,
  /** Foreign-key-ish back to outcome_events.event_id (loose: cross-row
   *  invariants enforced by the consumer; we avoid a hard FK so a slow
   *  event-insert and a fast billing-write don't race-fail). */
  event_id                 TEXT NOT NULL,
  outcome_kind             TEXT NOT NULL,
  property_id              TEXT NOT NULL,
  /** Calendar month bucket for the billing engine — YYYY-MM. */
  billing_month            TEXT NOT NULL,
  qualified                BOOLEAN NOT NULL,
  reason                   TEXT NOT NULL,
  /** Minor units (cents). Use bigint so a portfolio's monthly aggregate
   *  cannot overflow integer range. */
  billable_amount_minor    BIGINT NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL,
  /** PriceUnit applied (JSON of the discriminated union). NULL when !qualified. */
  price_unit_applied       JSONB,
  scored_at_iso            TEXT NOT NULL,
  clawback_closes_at_iso   TEXT NOT NULL,
  inserted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outcome_billing_lines_kind_chk
    CHECK (outcome_kind IN ('ticket_resolved_within_sla', 'rent_collected', 'vacancy_filled')),
  CONSTRAINT outcome_billing_lines_month_chk
    CHECK (billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- Idempotency: one billing line per record id per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outcome_billing_lines_record
  ON outcome_billing_lines (tenant_id, record_id);

-- Aggregation: per-tenant per-month is the dominant read path.
CREATE INDEX IF NOT EXISTS idx_outcome_billing_lines_month
  ON outcome_billing_lines (tenant_id, billing_month);

-- Drill-down: per-property per-kind.
CREATE INDEX IF NOT EXISTS idx_outcome_billing_lines_property_kind
  ON outcome_billing_lines (tenant_id, property_id, outcome_kind);
