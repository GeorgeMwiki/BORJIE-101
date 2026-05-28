/**
 * Process-wide registry for the daily-brief cron handle.
 *
 * Lets the Hono route at `POST /api/v1/owner/daily-brief/trigger`
 * grab the SAME `DailyBriefCronHandle` instance that
 * `services/api-gateway/src/index.ts` constructs at boot, without
 * threading the handle through every router constructor.
 *
 * One module-level variable is fine here: each gateway process runs a
 * single cron instance, and the registry is set exactly once during
 * bootstrap before any HTTP handler can call into it.
 */

import type { DailyBriefCronHandle } from './daily-brief-cron';

let currentHandle: DailyBriefCronHandle | null = null;

/** Set the live cron handle. Called once at gateway bootstrap. */
export function registerDailyBriefCron(
  handle: DailyBriefCronHandle,
): void {
  currentHandle = handle;
}

/** Read the live cron handle. Returns null when bootstrap is incomplete
 *  (e.g. degraded mode without a DB). */
export function getDailyBriefCron(): DailyBriefCronHandle | null {
  return currentHandle;
}

/** Test-only: clear the registry between cases. */
export function _clearDailyBriefCronForTests(): void {
  currentHandle = null;
}
