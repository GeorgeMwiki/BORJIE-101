-- =============================================================================
-- 0232: tab_event_log — Piece L brain-tab loop event log.
--
-- Append-only audit of every state transition a proposal undergoes:
-- created → pending_hitl → accepted/declined/edited/expired/failed.
-- Each event row also captures the actor (user or system), the
-- transport (chat/api/realtime), and a snapshot of the proposal at
-- that moment for replay.
--
-- This pairs with `ai_audit_chain` (which hash-chains AI turns): this
-- log records the SAME transitions for the tab side, so an auditor can
-- reconstruct the full brain↔tab handshake from either side.
--
-- This migration:
--   1. Creates `tab_event_log` — tenant-scoped, FK to module_update_proposals.
--   2. Indexes: (tenant_id, created_at DESC) for tenant-wide audit list,
--      (proposal_id, created_at) for per-proposal timeline, (event_kind)
--      for filtering by transition type.
--   3. Gold-standard RLS pattern from 0185.
--
-- Event kinds:
--   capture_emitted        — capture row written
--   proposal_created       — dispatcher emitted a proposal
--   proposal_auto_applied  — confidence high enough; handler called
--   proposal_pending_hitl  — confidence below auto-apply; awaits human
--   proposal_approved      — HITL approved
--   proposal_declined      — HITL declined
--   proposal_edited        — HITL edited payload + approved
--   proposal_expired       — TTL elapsed
--   proposal_failed        — handler returned error
--   proactive_nudge        — confidence below router threshold; nudge sent
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the tab_event_log table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tab_event_log (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Capture row that this event chains back to. NULL only for
   *  out-of-band proactive nudges that didn't originate in a capture. */
  capture_id               TEXT,
  /** Proposal id when the event is proposal-level (NULL for capture_emitted/proactive_nudge). */
  proposal_id              TEXT,
  /** Soft FK to modules (Piece B). */
  module_template_id       TEXT,
  /** Persona that authored. */
  persona_id               TEXT NOT NULL,
  /** Event kind: see header comment for full list. */
  event_kind               TEXT NOT NULL,
  /** Actor: 'system' | 'user:<user_id>' | 'cron'. */
  actor                    TEXT NOT NULL,
  /** Transport: 'chat' | 'api' | 'realtime' | 'cron'. */
  transport                TEXT NOT NULL DEFAULT 'api',
  /** Snapshot of the proposal state at this moment (JSON). */
  snapshot                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Notes from the actor (decline reason, edit summary, etc.). */
  notes                    TEXT,
  /** Sequence number for ordering within a proposal_id timeline. */
  sequence                 BIGINT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tab_event_log_tenant_created_idx
  ON tab_event_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tab_event_log_proposal_idx
  ON tab_event_log (proposal_id, sequence);

CREATE INDEX IF NOT EXISTS tab_event_log_kind_idx
  ON tab_event_log (tenant_id, event_kind);

CREATE INDEX IF NOT EXISTS tab_event_log_capture_idx
  ON tab_event_log (capture_id);

COMMENT ON TABLE tab_event_log IS
  'Piece L — append-only audit of brain↔tab handshake transitions. Pairs with ai_audit_chain on the AI-turn side.';

COMMENT ON COLUMN tab_event_log.event_kind IS
  'capture_emitted | proposal_created | proposal_auto_applied | proposal_pending_hitl | proposal_approved | proposal_declined | proposal_edited | proposal_expired | proposal_failed | proactive_nudge';

COMMENT ON COLUMN tab_event_log.actor IS
  'system | user:<user_id> | cron. Free-form to allow future actor types (handler, webhook, agent).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tab_event_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
