-- =============================================================================
-- Migration 0321 — md_commitments: the MD's durable DEFERRAL / FOLLOW-THROUGH
-- commitment ledger (the brain's prospective-memory organ + the closed loop).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- An LLM brain has NO native prospective memory: a model not currently being
-- prompted about a commitment will not act on it (no "wake me at T" / "wake me
-- when condition C holds" inside the weights). The only reliable design is to
-- externalise the intention as a FIRST-CLASS DURABLE ROW the moment it is
-- formed — with its trigger — and let an external driver loop (the EstateMind
-- RECONCILE sweep + the reminders-dispatch poll) bring it back at the right
-- moment. Mr. Mwikila, the veteran autonomous MD, DEFERS with intent, holds a
-- durable backlog here, schedules the return (by clock AND by event), nudges on
-- a graduated ladder, escalates with a safe-halt, FOLLOWS THROUGH to confirm it
-- actually happened, writes closure to the audit chain, and NEVER drops a
-- thread. This table is the single source of truth that capability needs.
--
-- See Docs/research/THE_BRAIN_DEFERRAL_FOLLOWTHROUGH_CAPABILITY.md §2.1.
--
-- ONE TABLE
--   * md_commitments — one durable, append-only-lifecycle row per deferred MD
--     commitment. The GTD taxonomy collapses into ONE `class` discriminator
--     (next_action | waiting_for | tickler | someday). The WAIT-FOR trigger is
--     ONE of three typed shapes (time | event | condition) carried in
--     `trigger_kind` + `trigger_spec` (jsonb: { dueAt } | { eventKey } |
--     { predicate }) with `trigger_deadline` as the event/condition fallback so
--     silence never drops a thread. The lifecycle is honest:
--     open | scheduled | overdue | blocked | done | reopened — `done` is set
--     ONLY on positive proof of completion (confirmed_at + confirmation_kind),
--     never optimistically.
--
-- SOVEREIGN RAIL (CLAUDE.md hard rule): a row with `sovereign=true`
-- (licence renewal/suspension, royalty filing, money movement, deletion) is
-- HITL FOREVER. The brain may track / schedule / remind / escalate it — it
-- NEVER auto-actuates it. An overdue sovereign commitment ESCALATES to the
-- mwikila_actions_inbox safe-halt; it does not auto-file. This table stores the
-- flag; the reconcile sweep + ladder enforce the rail.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as the situational_model / cognitive_memory_* / memory_v2_*
-- families, migrations 0317 / 0309 / 0312). FORCE-enables RLS with a
-- tenant-isolation policy on the canonical `app.current_tenant_id` GUC (bare
-- compare, no cast; NEVER the legacy `app.tenant_id`) PLUS a service-role
-- bypass mirroring 0309/0312/0314/0317 so the out-of-band RECONCILE worker
-- (withServiceRoleContext / the leader heartbeat / the reminders poll) can
-- read + advance commitments while RLS FORCE still isolates every request path.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column (no backfill hazard) so the NOT-NULL safety
-- validator passes. The UNIQUE(tenant_id, idempotency_key) makes DETECT writes
-- idempotent — the same deferral is never double-created.
--
-- Companion files:
--   * packages/database/src/schemas/md-commitments.schema.ts
--   * packages/database/src/repositories/md-commitment-repository.ts
--   * services/api-gateway/src/composition/estate-mind-wiring.ts (reconcile sweep)
--   * packages/database/src/migrations/down/0321_down_md_commitments.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- md_commitments — the durable backlog the MD re-reads (and the loop rewrites)
-- every reconcile tick. The commitment survives a worker restart, a model-
-- context reset, and a week of owner silence because it lives in Postgres.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS md_commitments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL,
  -- The owner the commitment is held for (forensic replay; the surface target).
  owner_id           text        NOT NULL DEFAULT 'mwikila',
  -- Ties to a work-cycle pending_thread / chat thread (open-thread continuity).
  thread_id          text,
  -- GTD taxonomy as ONE discriminator.
  class              text        NOT NULL,
  -- Domain verb: 'royalty.filing' | 'licence.renewal' | 'offtake.confirm' ...
  kind               text        NOT NULL DEFAULT 'general',
  title              text        NOT NULL,
  -- Bilingual absolutism (CLAUDE.md): complete EN + SW for every surfaced copy.
  title_sw           text        NOT NULL,
  rationale          text        NOT NULL,
  -- Evidence-required hard rule: >=1 evidence_id from LMBM / intelligence corpus.
  evidence_ids       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- The WAIT-FOR trigger — one of three, typed.
  trigger_kind       text        NOT NULL,
  -- jsonb discriminated union: time → { "dueAt": <iso> };
  --   event → { "eventKey": "ledger.credit" }; condition → { "predicate": {...} }.
  trigger_spec       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Event/condition FALLBACK timer so silence still surfaces (never a dropped
  -- thread). For time triggers this mirrors trigger_spec.dueAt for index reuse.
  trigger_due_at     timestamptz,
  -- Lifecycle (closure-by-confirmation). Honest status — never optimistic.
  status             text        NOT NULL DEFAULT 'open',
  -- Current ladder rung (0=in-app .. 4=mining_escalations); see LadderEngine.
  rung_level         integer     NOT NULL DEFAULT 0,
  -- HIGH-risk: licence/royalty/money/deletion → safe-halt, HITL forever.
  sovereign          boolean     NOT NULL DEFAULT false,
  -- Idempotent resurfacing stamp (reuse the proactive last_surfaced pattern).
  last_nudged_at     timestamptz,
  -- Positive-proof acknowledgement of a surfaced rung (gates rung advance).
  acked_at           timestamptz,
  -- Set ONLY on positive proof of completion.
  confirmed_at       timestamptz,
  -- 'regulator_ack' | 'ledger_entry' | 'owner_approved' | ... (proof kind).
  confirmation_kind  text,
  -- Why a commitment was blocked / abandoned (honest status).
  blocked_reason     text,
  -- Reuse the 0303 retry discipline for surface/delivery attempts.
  attempt_count      integer     NOT NULL DEFAULT 0,
  -- Hash-chained closure stitch (append-only), exactly as 0129 stitches.
  audit_chain_hash   text,
  -- UNIQUE(tenant_id, idempotency_key) — never double-create the same deferral.
  idempotency_key    text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT md_commitments_class_chk CHECK (
    class IN ('next_action', 'waiting_for', 'tickler', 'someday')
  ),
  CONSTRAINT md_commitments_trigger_kind_chk CHECK (
    trigger_kind IN ('time', 'event', 'condition')
  ),
  CONSTRAINT md_commitments_status_chk CHECK (
    status IN ('open', 'scheduled', 'overdue', 'blocked', 'done', 'reopened')
  ),
  -- done is honest: it can only carry a confirmation proof.
  CONSTRAINT md_commitments_done_proof_chk CHECK (
    status <> 'done' OR confirmed_at IS NOT NULL
  )
);

-- Time-trigger claim (the reminders-dispatch poll re-aimed): the hot scan for
-- due/overdue time commitments still waiting to fire.
CREATE INDEX IF NOT EXISTS md_commitments_due_idx
  ON md_commitments (trigger_due_at)
  WHERE status IN ('open', 'scheduled') AND trigger_kind = 'time';

-- Reconcile sweep: re-read all live commitments for a tenant, freshest first.
CREATE INDEX IF NOT EXISTS md_commitments_open_idx
  ON md_commitments (tenant_id, status, updated_at DESC);

-- Event/condition fallback-deadline sweep so silence still surfaces.
CREATE INDEX IF NOT EXISTS md_commitments_deadline_idx
  ON md_commitments (trigger_due_at)
  WHERE status IN ('open', 'scheduled') AND trigger_due_at IS NOT NULL;

-- Event-trigger lookup: flip waiting_for → due on a fired eventKey.
CREATE INDEX IF NOT EXISTS md_commitments_event_idx
  ON md_commitments (tenant_id, trigger_kind, status)
  WHERE trigger_kind = 'event';

-- DETECT idempotency — never double-create the same deferral.
CREATE UNIQUE INDEX IF NOT EXISTS md_commitments_idem_uniq
  ON md_commitments (tenant_id, idempotency_key);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band reconcile worker) + guarded anon REVOKE. Mirrors the 0309 / 0312
-- / 0314 / 0317 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'md_commitments'
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

COMMENT ON TABLE md_commitments IS
  'Mr. Mwikila DEFERRAL / FOLLOW-THROUGH commitment ledger (prospective memory '
  '+ the closed loop). One durable row per deferred MD commitment: GTD class, '
  'typed WAIT-FOR trigger (time|event|condition), honest lifecycle, ladder rung, '
  'sovereign safe-halt flag, evidence ids, hash-chained closure. The EstateMind '
  'RECONCILE sweep re-reads every OPEN row each tick and NEVER drops a thread.';

COMMIT;
