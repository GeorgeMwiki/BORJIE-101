/**
 * Follow-Up — Heartbeat Scheduler
 *
 * Pure function that walks an in-memory snapshot of pending follow-ups
 * and computes which became due, which escalated, and which are still
 * snoozed at the given `now`. Side effects (DB writes, MD events) belong
 * in the caller — this module is deterministic for testability.
 *
 * Wired into `src/core/heartbeat` via a thin adapter; the heartbeat tick
 * calls `runFollowUpScheduler({ now, pending })` and dispatches the
 * resulting events.
 *
 * @module features/central-command/md/follow-up/scheduler
 */

import { computeEscalation, applyEscalation } from "./escalation";
import type { FollowUp, SchedulerTickOutput } from "./types";

export interface SchedulerInput {
  readonly now: Date;
  /** All follow-ups whose status is `pending` or `escalated`. */
  readonly pending: ReadonlyArray<FollowUp>;
}

/**
 * Run the scheduler tick. Pure function: same inputs → same outputs.
 */
export function runFollowUpScheduler(
  input: SchedulerInput,
): SchedulerTickOutput {
  const tickId = `fu-tick-${input.now.getTime()}`;
  const takenAt = input.now.toISOString();

  const becameDue: FollowUp[] = [];
  const escalated: FollowUp[] = [];
  const stillSnoozed: FollowUp[] = [];

  for (const fu of input.pending) {
    if (isStillSnoozed(fu, input.now)) {
      stillSnoozed.push(fu);
      continue;
    }
    const result = computeEscalation(fu, input.now);
    const due = new Date(fu.dueAt).getTime();
    const isDue = due <= input.now.getTime();

    if (!isDue) continue;

    if (result.level > 0) {
      const next = applyEscalation(fu, result);
      escalated.push(next);
    } else if (fu.status === "pending") {
      becameDue.push(
        Object.freeze({
          ...fu,
          status: "due",
        }),
      );
    }
  }

  return Object.freeze({
    tickId,
    takenAt,
    becameDue: Object.freeze(becameDue),
    escalated: Object.freeze(escalated),
    stillSnoozed: Object.freeze(stillSnoozed),
  });
}

function isStillSnoozed(fu: FollowUp, now: Date): boolean {
  if (!fu.snoozedUntil) return false;
  const until = new Date(fu.snoozedUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * Partition a list of follow-ups by lifecycle bucket. Convenience for
 * UIs that want "due now / due soon / overdue".
 */
export function partitionByBucket(
  fus: ReadonlyArray<FollowUp>,
  now: Date,
): {
  readonly overdue: ReadonlyArray<FollowUp>;
  readonly dueNow: ReadonlyArray<FollowUp>;
  readonly dueSoon: ReadonlyArray<FollowUp>;
  readonly upcoming: ReadonlyArray<FollowUp>;
} {
  const overdue: FollowUp[] = [];
  const dueNow: FollowUp[] = [];
  const dueSoon: FollowUp[] = [];
  const upcoming: FollowUp[] = [];
  const nowMs = now.getTime();
  const DAY = 24 * 60 * 60 * 1000;

  for (const fu of fus) {
    const due = new Date(fu.dueAt).getTime();
    if (due < nowMs - 60 * 1000) overdue.push(fu);
    else if (due <= nowMs + 60 * 1000) dueNow.push(fu);
    else if (due <= nowMs + DAY) dueSoon.push(fu);
    else upcoming.push(fu);
  }

  return Object.freeze({
    overdue: Object.freeze(overdue),
    dueNow: Object.freeze(dueNow),
    dueSoon: Object.freeze(dueSoon),
    upcoming: Object.freeze(upcoming),
  });
}
