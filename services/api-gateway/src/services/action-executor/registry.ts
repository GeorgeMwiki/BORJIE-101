/**
 * Action-executor registry + dispatcher.
 *
 * Maps an action `verb` → its handler. ONLY a deliberately small, SAFE
 * set is registered for this wave:
 *
 *   set_reminder    — insert an owner reminder (non-money calendar item)
 *   snooze_reminder — push an existing reminder's trigger forward
 *
 * Money / ledger / hire / licence / site verbs are intentionally NOT
 * here — they need LedgerService + domain repos and land in later waves.
 * Keeping the safe set explicit means the brain-teach auto-execute path
 * can ask `isSafeVerb(verb)` and refuse to execute anything else, so an
 * unvalidated model string can never trigger an unsafe side effect.
 *
 * The dispatcher runs the handler, and — on success only — bumps the
 * `user_action_tracker` mastery counter for the verb (best-effort, never
 * fails the execution). It NEVER decides authorization: callers MUST run
 * `decideAutoAuthorization` first and only dispatch when authorized.
 */

import {
  setReminderHandler,
  snoozeReminderHandler,
} from './handlers/reminders.js';
import { bumpActionMastery } from './mastery-tracker.js';
import type {
  ActionHandler,
  DispatchResult,
  ExecContext,
} from './types.js';

/**
 * The frozen SAFE registry. New verbs are added here deliberately — and
 * only after their domain repo + (where money is involved) LedgerService
 * path exists.
 */
const SAFE_REGISTRY: Readonly<Record<string, ActionHandler>> = Object.freeze({
  set_reminder: setReminderHandler,
  snooze_reminder: snoozeReminderHandler,
});

/** Normalise a model / FE verb token for registry lookup. */
function normalizeVerb(verb: string): string {
  return verb.trim().toLowerCase();
}

/**
 * TRUE when `verb` is in the SAFE registry. The brain-teach
 * auto-authorized path gates on this so it only auto-executes verbs the
 * registry can safely perform — unknown / unsafe verbs keep today's
 * badge-only (executed:false) behaviour.
 */
export function isSafeVerb(verb: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    SAFE_REGISTRY,
    normalizeVerb(verb),
  );
}

/** The registered SAFE verb names — handy for tests + diagnostics. */
export function safeVerbs(): ReadonlyArray<string> {
  return Object.freeze(Object.keys(SAFE_REGISTRY));
}

/**
 * Dispatch a verb to its handler.
 *
 * - Unknown verb → `{ executed:false, reason:'unknown_action' }`. Never
 *   throws for an unknown verb (graceful by design).
 * - Handler throws (bad input / DB error) → caught and returned as
 *   `{ executed:false, reason }` so a failed side effect never crashes
 *   the request or the SSE stream.
 * - Success → `{ executed:true, result }`, and the verb's mastery
 *   counter is bumped (best-effort).
 *
 * The caller is responsible for authorization: this function assumes the
 * verb has ALREADY passed `decideAutoAuthorization`.
 */
export async function dispatchAction(
  verb: string,
  params: unknown,
  ctx: ExecContext,
): Promise<DispatchResult> {
  const normalized = normalizeVerb(verb);
  const handler = SAFE_REGISTRY[normalized];
  if (!handler) {
    return { executed: false, reason: 'unknown_action' };
  }

  try {
    const result = await handler(params, ctx);
    // Light up mastery / shortcuts — best-effort, never fails the verb.
    await bumpActionMastery(ctx, normalized);
    return { executed: true, result };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    ctx.logger.error?.(
      {
        wiring: 'action-executor-dispatch',
        verb: normalized,
        tenantId: ctx.tenantId,
        error: reason,
      },
      'action-executor: handler failed',
    );
    return { executed: false, reason };
  }
}
