-- ─────────────────────────────────────────────────────────────────────
-- Migration 0131 — Kernel-goals stall tracking columns.
--
-- Wave-K Tier-3 follow-up. The wake-loop's stall-detection sweep
-- (services/api-gateway/src/composition/wake-loop-cron.ts) emits
-- `agency.goal-stalled` events and asks the goals-repo to bump a
-- per-goal stall state. The kernel-goals table predates this hook
-- so two new columns are bolted on:
--
--   stall_reason  — short human-readable reason captured at the
--                   moment the wake-loop flagged the goal. Mirrors
--                   the stall-proposal's `reason` field.
--   stalled_at    — when the goal first transitioned to status =
--                   'stalled'. NULL when never stalled.
--
-- Both columns are nullable so backfill is a no-op and rolling
-- deploys never lock the table; the `markStalled(goalId, reason)`
-- service method (kernel-goals.service.ts) populates them as goals
-- transition.
--
-- Status enum stays a TEXT column (matches migration 0123 style);
-- `'stalled'` becomes one more legal value alongside active /
-- paused / blocked / completed / abandoned.
--
-- Idempotent: ADD COLUMN ... IF NOT EXISTS guards. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE kernel_goals
  ADD COLUMN IF NOT EXISTS stall_reason TEXT;

ALTER TABLE kernel_goals
  ADD COLUMN IF NOT EXISTS stalled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kernel_goals_stalled_at
  ON kernel_goals (stalled_at)
  WHERE stalled_at IS NOT NULL;

COMMENT ON COLUMN kernel_goals.stall_reason IS
  'Short reason captured when the wake-loop''s stall-detection sweep flagged the goal. Mirrors the stalled-goal proposal''s `reason` field. Null when the goal has never stalled.';

COMMENT ON COLUMN kernel_goals.stalled_at IS
  'Timestamp of the most recent transition to status = ''stalled''. Null when the goal has never stalled. Indexed (partial, NOT NULL) for cheap dashboards.';
