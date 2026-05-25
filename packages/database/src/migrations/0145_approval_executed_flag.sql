-- ─────────────────────────────────────────────────────────────────────
-- Migration 0145 — Sovereign-approvals `executed` flag (one-shot
-- consumption guard).
--
-- Phase D D2 — Comprehensive Gap Closure.
--
-- The four-eye approval gate (table `sovereign_approvals`) tracks an
-- approval lifecycle ('pending' → 'one-eye' → 'approved' / 'rejected'
-- / 'expired'). Until now the executor could consume an `approved`
-- action MULTIPLE times, which is a replay-attack surface — an
-- attacker who recovers an approved action-id could re-trigger the
-- side-effect indefinitely.
--
-- This column flips to TRUE on first consumption and stays TRUE
-- forever. Subsequent attempts return the `already-executed` error
-- code via the kernel-side ApprovalGate.markExecuted() path.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS. Default FALSE so legacy
-- rows are treated as unconsumed (operators must walk the audit log
-- to confirm — see Phase D follow-up).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE sovereign_approvals
  ADD COLUMN IF NOT EXISTS executed BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase D D2 — also add a plan-artifact column. The approver UI now
-- shows a structured `{tier, steps[], risks[], reversalPlan}` plan
-- alongside the prose summary. Optional for legacy rows.
ALTER TABLE sovereign_approvals
  ADD COLUMN IF NOT EXISTS plan JSONB;

CREATE INDEX IF NOT EXISTS idx_sovereign_approvals_executed
  ON sovereign_approvals (executed)
  WHERE executed = FALSE;
