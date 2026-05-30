/**
 * Follow-Up — Escalation Policy
 *
 * Pure function: given a follow-up and `now`, return the escalation level
 * it deserves. The policy is based on % overdue relative to the original
 * lead time (`dueAt - createdAt`).
 *
 * Levels:
 *   0 — on time or snoozed
 *   1 — overdue by ≥ 25% of original lead time
 *   2 — overdue by ≥ 75% of original lead time
 *   3 — overdue by ≥ 150% of original lead time, or > 30 days late
 *
 * Priority is bumped one notch per level (capped at "urgent").
 *
 * @module features/central-command/md/follow-up/escalation
 */

import type { EscalationLevel, FollowUp, FollowUpPriority } from "./types";

const PRIORITY_LADDER: ReadonlyArray<FollowUpPriority> = Object.freeze([
  "low",
  "normal",
  "high",
  "urgent",
]);

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface EscalationResult {
  readonly level: EscalationLevel;
  readonly priority: FollowUpPriority;
  readonly overdueMs: number;
  readonly overduePct: number;
  /** True when the level changed vs. the input follow-up. */
  readonly changed: boolean;
}

/**
 * Compute the escalation level a follow-up should hold at time `now`.
 * Pure function — no side effects.
 */
export function computeEscalation(fu: FollowUp, now: Date): EscalationResult {
  const due = new Date(fu.dueAt).getTime();
  const created = new Date(fu.createdAt).getTime();
  const nowMs = now.getTime();
  const overdueMs = nowMs - due;

  // Snoozed follow-ups don't escalate. They re-enter when snoozedUntil
  // elapses; until then keep current state.
  if (fu.snoozedUntil) {
    const snoozeUntil = new Date(fu.snoozedUntil).getTime();
    if (Number.isFinite(snoozeUntil) && snoozeUntil > nowMs) {
      return Object.freeze({
        level: fu.escalationLevel,
        priority: fu.priority,
        overdueMs: 0,
        overduePct: 0,
        changed: false,
      });
    }
  }

  if (overdueMs <= 0) {
    return Object.freeze({
      level: 0 satisfies EscalationLevel,
      priority: fu.priority,
      overdueMs: 0,
      overduePct: 0,
      changed: fu.escalationLevel !== 0,
    });
  }

  const leadTimeMs = Math.max(due - created, MS_PER_DAY);
  const overduePct = overdueMs / leadTimeMs;

  let level: EscalationLevel = 0;
  if (overduePct >= 1.5 || overdueMs >= 30 * MS_PER_DAY) level = 3;
  else if (overduePct >= 0.75) level = 2;
  else if (overduePct >= 0.25) level = 1;

  const priority = bumpPriority(fu.priority, level);

  return Object.freeze({
    level,
    priority,
    overdueMs,
    overduePct,
    changed: level !== fu.escalationLevel || priority !== fu.priority,
  });
}

function bumpPriority(base: FollowUpPriority, steps: number): FollowUpPriority {
  const idx = PRIORITY_LADDER.indexOf(base);
  if (idx < 0) return base;
  const next = Math.min(idx + steps, PRIORITY_LADDER.length - 1);
  return PRIORITY_LADDER[next]!;
}

/**
 * Apply an escalation result to a follow-up, returning a NEW object.
 * Never mutates the input.
 */
export function applyEscalation(
  fu: FollowUp,
  result: EscalationResult,
): FollowUp {
  if (!result.changed) return fu;
  return Object.freeze({
    ...fu,
    escalationLevel: result.level,
    priority: result.priority,
    status: result.level > 0 ? "escalated" : fu.status,
  });
}
