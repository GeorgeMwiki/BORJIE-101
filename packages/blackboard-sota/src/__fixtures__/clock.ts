/**
 * Deterministic clock fixture — BLACKBOARD-CORE tests.
 *
 * A simple manually-advanced clock that returns the configured Date.
 * Used by region / posts / summary tests to deterministically set
 * `openedAt`, `postedAt`, and cron tick times without leaning on
 * `vi.useFakeTimers()`.
 */

export interface ManualClock {
  now(): Date;
  set(date: Date | string): void;
  advanceMs(ms: number): void;
}

export function createManualClock(initial: Date | string): ManualClock {
  let current = typeof initial === 'string' ? new Date(initial) : initial;
  return {
    now() {
      return new Date(current.getTime());
    },
    set(date) {
      current = typeof date === 'string' ? new Date(date) : date;
    },
    advanceMs(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}
