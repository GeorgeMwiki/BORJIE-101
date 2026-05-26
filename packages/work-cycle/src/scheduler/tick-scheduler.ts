/**
 * Tick scheduler — cadence selection (spec §4).
 *
 * Pure function: given a tenant's state (last_tick_at, current_mode)
 * + a clock + a per-mode cadence table, return the next due ISO
 * timestamp. The scheduler is event-driven — the host calls
 * `nextDueAt` once and arms a single `setTimeout` against the result.
 *
 *   mode    → default interval
 *   active  → 30 s
 *   idle    →  5 min
 *   night   → 15 min
 *   observe → 60 min
 *
 * Modes can be overridden per-tenant via the `cadenceMs` table.
 *
 * Mode transitions are NOT performed here — they happen on external
 * signals (user logs in → 'active'; cost cap reached → 'observe';
 * crosses 22:00 local → 'night'). The scheduler only computes
 * cadence for the current mode.
 */

import {
  DEFAULT_CADENCE_MS,
  type WorkCycleMode,
  type WorkCycleState,
} from '../types.js';

export interface SchedulerOptions {
  readonly cadenceMs?: Readonly<Record<WorkCycleMode, number>>;
  readonly now?: () => Date;
}

export interface TickScheduler {
  /**
   * Compute the next due tick timestamp for the given state. If
   * `last_tick_at` is null, returns `now()` (run immediately).
   */
  nextDueAt(state: WorkCycleState): string;

  /**
   * Compute the milliseconds until the next due tick, clamped at 0.
   * Useful for `setTimeout` arming.
   */
  msUntilNextTick(state: WorkCycleState): number;

  /**
   * Return true if the tenant is *overdue* (last_tick_at older than 2×
   * the mode's interval). Surfaces to crash revival.
   */
  isOverdue(state: WorkCycleState): boolean;

  /**
   * Get the configured interval for a given mode.
   */
  intervalMsFor(mode: WorkCycleMode): number;
}

export function createTickScheduler(
  options: SchedulerOptions = {},
): TickScheduler {
  const cadence = options.cadenceMs ?? DEFAULT_CADENCE_MS;
  const nowFn = options.now ?? (() => new Date());

  function intervalFor(mode: WorkCycleMode): number {
    return cadence[mode];
  }

  function nextDueDate(state: WorkCycleState): Date {
    if (state.last_tick_at === null) {
      return nowFn();
    }
    const last = new Date(state.last_tick_at).getTime();
    const interval = intervalFor(state.current_mode);
    return new Date(last + interval);
  }

  return {
    intervalMsFor: intervalFor,

    nextDueAt(state) {
      return nextDueDate(state).toISOString();
    },

    msUntilNextTick(state) {
      const due = nextDueDate(state).getTime();
      const now = nowFn().getTime();
      return Math.max(0, due - now);
    },

    isOverdue(state) {
      if (state.last_tick_at === null) return false;
      const last = new Date(state.last_tick_at).getTime();
      const now = nowFn().getTime();
      return now - last > 2 * intervalFor(state.current_mode);
    },
  };
}
