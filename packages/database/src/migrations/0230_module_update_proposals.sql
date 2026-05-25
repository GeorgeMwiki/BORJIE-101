-- =============================================================================
-- 0230: module_update_proposals — Piece L brain-tab loop proposals.
--
-- A proposal is the dispatcher's output: "the brain thinks tab X should
-- take action Y with payload Z". HITL gates them: low-confidence and
-- high-risk proposals stay `pending_hitl` until a human approves; the
-- accept_proposal handler then promotes them to `accepted` and the tab
-- realises the side-effect (e.g. `ESTATE.create_lease_application`).
--
-- This migration:
--   1. Creates `module_update_proposals` — tenant-scoped FK to
--      `conversation_capture` (capture row that authored the proposal).
--      `module_template_id` is a soft TEXT pointer (Piece B's modules
--      table lives on its own branch; promoted to FK when piece-b merges).
--   2. Indexes: (tenant_id, status, created_at DESC) for the pending-list
--      view, (tenant_id, module_template_id) for module-scoped queries,
--      (capture_id) for join-back, (tenant_id, persona_id) for persona
--      scoping.
--   3. Gold-standard RLS pattern from 0185.
--
-- Status transitions:
--   pending_hitl → accepted (via accept_proposal handler)
--   pending_hitl → declined (via decline_proposal handler)
--   pending_hitl → edited (when user mutates payload then approves;
--                          the original row is closed and a new row
--                          opened linking back via `edited_from_id`)
--   auto_applying → accepted (when confidence ≥ auto_apply_threshold)
--   auto_applying → failed   (when handler rejects after auto-apply)
--   * → expired              (when TTL passes without HITL action)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the module_update_proposals table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS module_update_proposals (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Capture row that triggered this proposal. */
  capture_id               TEXT NOT NULL REFERENCES conversation_capture(id) ON DELETE CASCADE,
  /** Soft FK to modules table from Piece B (e.g. 'ESTATE', 'LITFIN', 'TRC-EMU'). */
  module_template_id       TEXT NOT NULL,
  /** Action name from the routing matrix (e.g. 'create_lease_application'). */
  action                   TEXT NOT NULL,
  /** Persona that authored the underlying conversation capture. */
  persona_id               TEXT NOT NULL,
  /** Status: pending_hitl | auto_applying | accepted | declined | edited | expired | failed. */
  status                   TEXT NOT NULL DEFAULT 'pending_hitl',
  /** Confidence inherited from capture; gates auto-apply at dispatch time. */
  confidence               DOUBLE PRECISION NOT NULL,
  /** Whether HITL was required (matrix flag). */
  hitl_required            BOOLEAN NOT NULL DEFAULT TRUE,
  /** Routing matrix priority bucket: 'critical' | 'high' | 'medium' | 'low'. */
  priority                 TEXT NOT NULL DEFAULT 'medium',
  /** The candidate action payload — what the handler would execute. */
  payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Resolved canonical entity references (copied from capture for fast access). */
  entity_refs              JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Routing matrix row id (FK to platform default matrix or tenant override). */
  matrix_row_id            TEXT,
  /** Persona tier of the approver (1..5). */
  approver_tier            INTEGER,
  /** Approver user id (set when status flips to accepted/declined/edited). */
  approver_user_id         TEXT,
  /** Decline reason (free text, set when status='declined'). */
  decline_reason           TEXT,
  /** If this proposal supersedes another via edit, link back. */
  edited_from_id           TEXT,
  /** Failure detail when handler call rejects. */
  failure_reason           TEXT,
  /** When the proposal was acted on (accepted/declined/edited/expired/failed). */
  resolved_at              TIMESTAMPTZ,
  /** TTL — proposals older than this hit 'expired' state via cron. */
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS module_update_proposals_tenant_status_idx
  ON module_update_proposals (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS module_update_proposals_tenant_module_idx
  ON module_update_proposals (tenant_id, module_template_id);

CREATE INDEX IF NOT EXISTS module_update_proposals_capture_idx
  ON module_update_proposals (capture_id);

CREATE INDEX IF NOT EXISTS module_update_proposals_tenant_persona_idx
  ON module_update_proposals (tenant_id, persona_id);

CREATE INDEX IF NOT EXISTS module_update_proposals_expires_idx
  ON module_update_proposals (expires_at)
  WHERE status IN ('pending_hitl', 'auto_applying');

COMMENT ON TABLE module_update_proposals IS
  'Piece L — brain-to-tab proposed updates. HITL-gated when confidence below threshold or routing matrix marks the action high-risk.';

COMMENT ON COLUMN module_update_proposals.module_template_id IS
  'Soft FK to modules table from Piece B (claude/piece-b-dynamic-modules). Promoted to FK once piece-b merges.';

COMMENT ON COLUMN module_update_proposals.status IS
  'pending_hitl | auto_applying | accepted | declined | edited | expired | failed. Use the matching enum at the app boundary.';

COMMENT ON COLUMN module_update_proposals.priority IS
  'critical | high | medium | low. Drives UI sort order + alert routing.';

COMMENT ON COLUMN module_update_proposals.confidence IS
  'Capture confidence at dispatch time. Below router threshold should NOT create a proposal (we emit a proactive nudge instead). At-or-above sometimes still HITL (matrix flag).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'module_update_proposals'
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
