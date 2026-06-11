-- =============================================================================
-- Migration 0339 — md_commitment_timeline: the APPEND-ONLY lifecycle trail of
-- the MD's durable commitment ledger (the LIVING-MD organ's audit spine).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The `md_commitments` row (migration 0321) carries the CURRENT state of a
-- deferred MD commitment, but the owner-facing living-plan surface and the
-- forensic replay need the FULL HISTORY of how it got there: when it was
-- deferred, when an event flipped it due, when it became overdue, when a
-- proposal resurfaced it, and the positive-proof CLOSURE (or the honest reopen
-- when a deadline passed unconfirmed). That history is the "felt" loop — the MD
-- visibly following through — and it must be tamper-evident.
--
-- This table is the SAME hash-chained, append-only discipline the AI audit
-- chain uses (CLAUDE.md hard rule: "AI audit chain is hash-chained, append-only.
-- No mutation."). Each row stitches `audit_hash = sha256(previous_hash ||
-- commitment_id || event_kind || new_status || iso_ts)` so an independent
-- replay can detect a truncated / inserted / mutated trail. The PREVIOUS row's
-- hash links each new row to the one before it (per-commitment chain).
--
-- ONE TABLE
--   * md_commitment_timeline — one immutable row per lifecycle event of a
--     commitment. The event_kind taxonomy is honest about WHAT happened:
--     deferred | scheduled | became_due | overdue | nudged | blocked |
--     reopened | confirmed | done | someday_resurfaced. proof_kind +
--     evidence_ids carry the positive-proof closure (closure-by-confirmation,
--     never by timeout).
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as md_commitments / situational_model / cognitive_memory_*). FORCE
-- ROW LEVEL SECURITY with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC PLUS a service-role bypass (mirroring 0321) so the
-- out-of-band reconcile sweep / someday-review supervisor can append while RLS
-- FORCE still isolates every request path. Guarded anon REVOKE.
--
-- APPEND-ONLY (CLAUDE.md hard rule): a per-table UPDATE/DELETE-revoke trigger is
-- NOT added here (the app layer never updates a timeline row — it only INSERTs),
-- and the down migration drops the table wholesale; the hash-chain is the
-- tamper-evidence. Every NOT NULL is on a freshly-created column (no backfill
-- hazard) so the NOT-NULL safety validator passes.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/md-commitment-timeline.schema.ts
--   * services/api-gateway/src/composition/living-md/timeline-event-sink.ts
--   * packages/database/src/migrations/down/0339_down_md_commitment_timeline.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS md_commitment_timeline (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  -- The commitment this lifecycle event belongs to (md_commitments.id). No FK:
  -- same tenant-scoped, FK-free convention as md_commitments itself.
  commitment_id   text        NOT NULL,
  -- WHAT happened — honest lifecycle taxonomy.
  event_kind      text        NOT NULL,
  -- When the event occurred (the sink stamps it from the injected clock).
  event_at        timestamptz NOT NULL DEFAULT now(),
  -- Status transition (nullable on a non-transition event like nudged).
  previous_status text,
  new_status      text,
  -- Positive-proof closure metadata (closure-by-confirmation, never timeout).
  proof_kind      text,
  -- Evidence-required hard rule: the evidence ids cited at this event.
  evidence_ids    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Who/what caused the event: 'mwikila' | 'owner' | 'reconcile' | 'event:<key>'.
  actor           text        NOT NULL DEFAULT 'mwikila',
  -- Hash-chain stitch: sha256(previous_hash || commitment_id || event_kind ||
  -- new_status || iso_ts). The per-commitment chain links every row append-only.
  audit_hash      text        NOT NULL,
  -- The prior row's audit_hash this row chained from (NULL at the commitment's
  -- genesis timeline row). Persisting it lets replay verify the link.
  previous_hash   text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT md_commitment_timeline_event_kind_chk CHECK (
    event_kind IN (
      'deferred', 'scheduled', 'became_due', 'overdue', 'nudged',
      'blocked', 'reopened', 'confirmed', 'done', 'someday_resurfaced'
    )
  )
);

-- The living-plan surface read: a commitment's full trail, oldest → newest.
CREATE INDEX IF NOT EXISTS md_commitment_timeline_commitment_idx
  ON md_commitment_timeline (tenant_id, commitment_id, event_at);

-- The tenant-wide recent-activity feed (past tab on the living-plan surface).
CREATE INDEX IF NOT EXISTS md_commitment_timeline_tenant_recent_idx
  ON md_commitment_timeline (tenant_id, event_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band reconcile sweep / someday supervisor) + guarded anon REVOKE.
-- Mirrors the 0321 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'md_commitment_timeline'
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

COMMENT ON TABLE md_commitment_timeline IS
  'Append-only, hash-chained lifecycle trail of every MD commitment (the '
  'living-MD organ audit spine). One immutable row per lifecycle event '
  '(deferred → became_due → overdue → confirmed/done, or reopened on an '
  'unconfirmed deadline). proof_kind + evidence_ids carry the positive-proof '
  'closure (closure-by-confirmation, never by timeout). audit_hash stitches a '
  'per-commitment chain so a truncated/mutated trail is detectable. FORCE RLS '
  'on app.current_tenant_id + service-role bypass for the out-of-band sweep.';

COMMIT;
