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
-- This migration adds an additive `context` jsonb column to `mining_escalations`
-- so the org-path's extra fields (category / original severity scale /
-- escalated_to_staff_id / related_task_id / related_subject / origin_session_id)
-- survive losslessly once the writer (org-team-repository.raiseEscalation) is
-- repointed there. The escalations UI ignores it; the org-admin SELECT
-- reconstructs its return shape from it. The behavioural consolidation is the
-- WRITER repoint (code) — going forward every escalation lands in
-- mining_escalations where the UI reads/acks/resolves.
--
-- Additive · idempotent · fresh-safe: ADD COLUMN IF NOT EXISTS (no-op on
-- re-run; safe on a fresh DB where the 0081 table exists earlier in lex order).
-- Pure metadata, no backfill / lock / NOT-NULL hazard.
--
-- NOTE — historical backfill deferred: a one-time INSERT…SELECT of pre-existing
-- org_escalations rows was intentionally NOT included here. org_escalations and
-- mining_escalations differ in column TYPES (e.g. tenant_id uuid vs text) across
-- several columns, making a blanket backfill type-fragile; and the going-forward
-- writer repoint already fixes the consolidation. Migrating the (few) legacy
-- org_escalations rows is a separate, type-audited follow-up. No DROP of
-- org_escalations here.
-- =============================================================================

BEGIN;

ALTER TABLE mining_escalations
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN mining_escalations.context IS
  'Lossless side-channel for the MD agentic escalate path (org-team-repository): '
  'category, originalSeverity (low|normal|high|critical), escalatedToStaffId, '
  'relatedTaskId, relatedSubject, originSessionId. The escalations route/UI '
  'ignore this; org-admin reconstructs its return shape from it. See migration 0356.';

COMMIT;
