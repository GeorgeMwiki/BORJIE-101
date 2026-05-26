/**
 * Sync scheduler — decides when a given `OmnidataConnector` should run
 * its next sync. Pure planner: given the connector metadata, the last
 * successful sync timestamp, and the current time, return a decision.
 *
 * The orchestrator wraps this with rate-limit back-pressure (via
 * `@borjie/connectors` token-bucket) at execution time. The scheduler
 * itself is I/O-free.
 */

import type { ClockPort, OmnidataConnectorMetadata, RefreshPolicy } from '../types.js';

export type ScheduleDecision =
  | { readonly kind: 'run-now'; readonly reason: 'realtime-webhook' | 'pushed-event' | 'cron-due' | 'on-demand' | 'no-prior-sync' }
  | { readonly kind: 'defer'; readonly nextAttemptAt: string; readonly reason: string };

export interface ScheduleInput {
  readonly meta: OmnidataConnectorMetadata;
  readonly lastSyncedAt: string | null;
  readonly forceRun?: boolean;
}

/**
 * Cron evaluator — a deliberately conservative parser that supports
 * the subset we actually use in production:
 *   - "(asterisk)/N * * * *"   every N minutes
 *   - "0 (asterisk)/N * * *"   every N hours, on the hour
 *   - "0 H * * *"              daily at hour H
 *
 * Returns the next due timestamp relative to `from`.
 */
function nextCronDue(cron: string, fromIso: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return fromIso;
  }
  const [min, hour] = parts;
  const from = new Date(fromIso);

  const everyMinMatch = /^\*\/(\d+)$/.exec(min ?? '');
  if (everyMinMatch && hour === '*') {
    const stepMin = Number(everyMinMatch[1]);
    if (Number.isFinite(stepMin) && stepMin > 0) {
      const next = new Date(from.getTime() + stepMin * 60_000);
      return next.toISOString();
    }
  }

  const everyHourMatch = /^\*\/(\d+)$/.exec(hour ?? '');
  if (min === '0' && everyHourMatch) {
    const stepHour = Number(everyHourMatch[1]);
    if (Number.isFinite(stepHour) && stepHour > 0) {
      const next = new Date(from.getTime() + stepHour * 3_600_000);
      next.setUTCMinutes(0, 0, 0);
      return next.toISOString();
    }
  }

  const dailyMatch = /^(\d+)$/.exec(hour ?? '');
  if (min === '0' && dailyMatch) {
    const targetHour = Number(dailyMatch[1]);
    if (Number.isFinite(targetHour) && targetHour >= 0 && targetHour <= 23) {
      const next = new Date(from);
      next.setUTCMinutes(0, 0, 0);
      if (next.getUTCHours() >= targetHour) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      next.setUTCHours(targetHour);
      return next.toISOString();
    }
  }

  // Fallback: bump 1h
  return new Date(from.getTime() + 3_600_000).toISOString();
}

/**
 * Returns a `ScheduleDecision`. Pure — testable without side effects.
 */
export function decideSchedule(input: ScheduleInput, clock: ClockPort): ScheduleDecision {
  if (input.forceRun === true) {
    return { kind: 'run-now', reason: 'on-demand' };
  }

  const policy: RefreshPolicy = input.meta.refreshPolicy;

  switch (policy.kind) {
    case 'realtime':
      if (input.lastSyncedAt === null) {
        return { kind: 'run-now', reason: 'no-prior-sync' };
      }
      return { kind: 'defer', nextAttemptAt: input.lastSyncedAt, reason: 'webhook-driven' };

    case 'pushed':
      if (input.lastSyncedAt === null) {
        return { kind: 'run-now', reason: 'no-prior-sync' };
      }
      return { kind: 'defer', nextAttemptAt: input.lastSyncedAt, reason: 'subscription-driven' };

    case 'cron': {
      if (input.lastSyncedAt === null) {
        return { kind: 'run-now', reason: 'no-prior-sync' };
      }
      const due = nextCronDue(policy.cron, input.lastSyncedAt);
      const now = clock.nowIso();
      if (Date.parse(due) <= Date.parse(now)) {
        return { kind: 'run-now', reason: 'cron-due' };
      }
      return { kind: 'defer', nextAttemptAt: due, reason: `cron-${policy.cron}` };
    }

    case 'on-demand':
      return { kind: 'defer', nextAttemptAt: clock.nowIso(), reason: 'on-demand-only' };
  }
}
