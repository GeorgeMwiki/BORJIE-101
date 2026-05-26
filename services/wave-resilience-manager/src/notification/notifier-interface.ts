/**
 * Notifier interface — single method used by the resumer when a wave
 * is escalated to `unrecoverable` (either by hitting the per-wave
 * 3-attempt cap or the platform-wide daily 50-attempt budget).
 *
 * Notifiers MUST NOT throw: send failures are logged and swallowed.
 * The resilience manager treats notifications as best-effort; the
 * authoritative escalation record is the `unrecoverable` row in
 * `wave_progress` (sealed in the audit chain).
 */

import type { ResilienceLogger } from '../types.js';

export interface UnrecoverableNotice {
  readonly wave_id: string;
  readonly attempts: number;
  readonly reason: string;
  /** Optional human-readable detail (e.g. tenant id, last checkpoint). */
  readonly detail?: string;
}

export interface Notifier {
  /** Best-effort notification. Returns true if successfully delivered. */
  notifyUnrecoverable(notice: UnrecoverableNotice): Promise<boolean>;
}

/**
 * Format the canonical operator-facing message body. Kept here so SMS,
 * Slack, and email all share the same phrasing.
 */
export function formatUnrecoverableBody(notice: UnrecoverableNotice): string {
  const base = `[Borjie] Wave ${notice.wave_id} unrecoverable after ${notice.attempts} attempts. Reason: ${notice.reason}. Check admin panel for details.`;
  if (notice.detail && notice.detail.length > 0) {
    return `${base} (${notice.detail})`;
  }
  return base;
}

/**
 * Helper for adapters: log a warning + swallow. Centralised so the
 * "never throw" contract is enforced in one place.
 */
export function logAndSwallow(
  logger: ResilienceLogger | undefined,
  err: unknown,
  channel: string,
  notice: UnrecoverableNotice,
): false {
  logger?.warn(
    {
      channel,
      wave_id: notice.wave_id,
      err: err instanceof Error ? err.message : String(err),
    },
    'notifier: send failed — swallowing',
  );
  return false;
}
