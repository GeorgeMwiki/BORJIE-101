-- =============================================================================
-- Migration 0356 — Consolidate org_escalations → mining_escalations (TZ3)
--
-- Finding (HIGH wiring): two divergent escalation tables existed.
--
--   mining_escalations  — the AUTHORITATIVE table the escalations route + UI
--                         read, acknowledge and resolve (migration 0081).
--   org_escalations     — a DIFFERENT-shaped table the MD agentic `escalate`
--                         tool writer (org-team-repository.raiseEscalation,
--                         migration 0280) wrote into. The UI never reads it,
--                         so those rows were invisible AND unclosable.
--
-- This migration:
--   (1) Adds an additive `context` jsonb column to `mining_escalations` so the
--       org-path's extra fields (category / original severity scale /
--       escalated_to_staff_id / related_task_id / related_subject /
--       origin_session_id) survive losslessly once the writer is repointed
--       there. The escalations UI ignores it; the org-admin SELECT reconstructs
--       its return shape from it.
--   (2) One-time backfills any pre-existing `org_escalations` rows into
--       `mining_escalations` so previously-stranded escalations become visible
--       and closable in the one place the UI reads.
--
-- Additive · idempotent · fresh-safe:
--   - ADD COLUMN IF NOT EXISTS (no-op on re-run, safe on fresh DB where the
--     0081 table already exists earlier in lex order).
--   - The backfill is guarded by the existence of `org_escalations` (a fresh
--     DB created from 0280 will have it; if it were ever absent the block is a
--     no-op) and is ON CONFLICT (id) DO NOTHING so re-runs never duplicate.
--   - No DROP of org_escalations here — the writer repoint is the behavioural
--     fix; dropping the legacy table is a separate, later concern.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (1) Additive lossless context bag for the org-agentic escalate path.
-- -----------------------------------------------------------------------------

ALTER TABLE mining_escalations
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN mining_escalations.context IS
  'Lossless side-channel for the MD agentic escalate path (org-team-repository): '
  'category, originalSeverity (low|normal|high|critical), escalatedToStaffId, '
  'relatedTaskId, relatedSubject, originSessionId. The escalations route/UI '
  'ignore this; org-admin reconstructs its return shape from it. See migration 0356.';

-- -----------------------------------------------------------------------------
-- (2) One-time backfill: lift previously-stranded org_escalations rows into the
--     authoritative table so they become visible + closable. Guarded by table
--     existence; ON CONFLICT DO NOTHING for idempotency.
--
--     Mapping (mirrors the repointed writer in org-team-repository.ts):
--       title + reason            -> context_sw  ("<title>\n\n<reason>")
--       severity scale            -> low->info, normal->warning,
--                                    high|critical->critical
--       related_task_id present   -> source_kind='task',  source_id=related_task_id
--       else by category          -> safety_incident->safety,
--                                    compliance_breach|payment_default->incident,
--                                    other->task (always one of the 5 allowed)
--       escalated_to_staff_id set -> to_user_id=that id,  to_role=NULL
--       else                      -> to_role='manager',   to_user_id=NULL
--       status                    -> open|acknowledged|resolved kept; legacy
--                                    in_progress->acknowledged, cancelled->resolved
--       all org-only fields       -> context jsonb (lossless)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'org_escalations'
  ) THEN
    INSERT INTO mining_escalations (
      id, tenant_id, raised_by_user_id, to_user_id, to_role,
      source_kind, source_id, context_sw, severity, status,
      acknowledged_at, resolved_at, created_at, context, provenance
    )
    SELECT
      oe.id,
      oe.tenant_id::text,
      COALESCE(oe.raised_by_user_id, '__system__'),
      CASE WHEN oe.escalated_to_staff_id IS NOT NULL
           THEN oe.escalated_to_staff_id::text END,
      CASE WHEN oe.escalated_to_staff_id IS NULL
           THEN 'manager' END,
      CASE
        WHEN oe.related_task_id IS NOT NULL THEN 'task'
        WHEN oe.category = 'safety_incident' THEN 'safety'
        WHEN oe.category IN ('compliance_breach', 'payment_default') THEN 'incident'
        ELSE 'task'
      END,
      CASE WHEN oe.related_task_id IS NOT NULL
           THEN oe.related_task_id::text END,
      -- context_sw is the UI narrative; guarantee non-empty (title is NOT NULL).
      oe.title || E'\n\n' || oe.reason,
      CASE oe.severity
        WHEN 'low'      THEN 'info'
        WHEN 'normal'   THEN 'warning'
        WHEN 'high'     THEN 'critical'
        WHEN 'critical' THEN 'critical'
        ELSE 'warning'
      END,
      CASE oe.status
        WHEN 'in_progress' THEN 'acknowledged'
        WHEN 'cancelled'   THEN 'resolved'
        WHEN 'open'         THEN 'open'
        WHEN 'acknowledged' THEN 'acknowledged'
        WHEN 'resolved'     THEN 'resolved'
        ELSE 'open'
      END,
      CASE WHEN oe.status IN ('acknowledged', 'in_progress', 'resolved', 'cancelled')
           THEN oe.updated_at END,
      CASE WHEN oe.status IN ('resolved', 'cancelled')
           THEN oe.updated_at END,
      oe.created_at,
      jsonb_strip_nulls(jsonb_build_object(
        'orgPath',           true,
        'category',          oe.category,
        'originalSeverity',  oe.severity,
        'escalatedToStaffId', oe.escalated_to_staff_id,
        'relatedTaskId',     oe.related_task_id,
        'relatedSubject',    oe.related_subject,
        'originSessionId',   oe.origin_session_id
      )),
      oe.provenance
    FROM org_escalations oe
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;
