/**
 * Action-executor registry + dispatcher.
 *
 * Maps an action `verb` → its handler AND a per-verb trust class:
 *
 *   autoSafe:true  — the verb is benign enough to run on the
 *                    brain-teach auto-execute path WITHOUT an explicit
 *                    human confirmation (reminders — a non-money calendar
 *                    item).
 *   autoSafe:false — the verb is CONFIRM-REQUIRED. It performs a real,
 *                    durable domain mutation (a site / an employee row)
 *                    and MUST NOT run unless the owner explicitly
 *                    confirmed it via a `confirmation_card`. ONLY the
 *                    `/api/v1/owner/chat/confirm-action` endpoint runs
 *                    these; the auto-safe paths refuse them.
 *
 * Registered verbs:
 *   set_reminder    — insert an owner reminder         (autoSafe:true)
 *   snooze_reminder — push a reminder forward           (autoSafe:true)
 *   create_site     — insert a physical mining site     (autoSafe:false)
 *   add_employee    — insert a workforce HR record      (autoSafe:false)
 *   create_licence  — insert a mining licence/title     (autoSafe:false)
 *   log_production  — insert a production output record (autoSafe:false)
 *
 * Money / ledger / royalty / payroll / sovereign verbs are intentionally
 * NOT here — they MUST go through `LedgerService.post()` (CLAUDE.md hard
 * rule) and need four-eye flows; they land in a later wave. See the
 * DEFERRED MONEY VERBS block below for the precise list + rationale.
 *
 * The confirm-required domain verbs above are NON-MONEY by construction:
 *   - sites carry no money column.
 *   - employees carry one (`wage_rate_tzs`) that is DELIBERATELY left unset
 *     (see handlers/workforce.ts).
 *   - licences carry only a `fees` jsonb, left at its `{}` DB default — no
 *     fee/royalty figure is written (see handlers/licences.ts).
 *   - production_records carry NO money column at all (mass/grade only —
 *     see handlers/production.ts).
 * So all four use their domain repos directly (no LedgerService).
 *
 * ─── DEFERRED MONEY VERBS (NOT registered — do NOT add here) ───────────
 * The following verbs were explicitly considered and DEFERRED. They each
 * write the money path and therefore MUST be routed through
 * `LedgerService.post()` in `services/payments-ledger/` (the immutable
 * double-entry invariant — CLAUDE.md hard rule), behind the relevant
 * four-eye / policy flow. Registering them here as plain domain inserts
 * would bypass the ledger and is FORBIDDEN. They will land in a dedicated
 * money-actions wave that calls LedgerService — not in this registry.
 *
 *   file_royalty  — posts a royalty liability/payment → MUST debit/credit
 *                   the ledger (royalty is a money obligation, not a note).
 *   set_payroll   — sets/commits payroll figures → wage money path; goes
 *                   through payroll-runs + LedgerService, never a raw insert.
 *   post_ledger   — by definition a ledger posting → the ONLY legal path is
 *                   LedgerService.post(); never a direct write from chat.
 * ───────────────────────────────────────────────────────────────────────
 *
 * How auto-execution of a confirm-required verb is prevented (defence in
 * depth — any ONE of these blocks it):
 *   1. `isSafeVerb(verb)` returns FALSE for create_site / add_employee, so
 *      brain-teach.hono.ts (which gates auto-execute on `isSafeVerb`) never
 *      dispatches them — it keeps the badge-only behaviour instead.
 *   2. The `/micro-action` endpoint (auto-safe surface) checks
 *      `requiresConfirmation(verb)` and returns `{ executed:false,
 *      reason:'confirmation_required' }` before it ever reaches the gate.
 *   3. The fail-closed `decideAutoAuthorization` gate still runs first in
 *      `/confirm-action`; dispatch only happens when it authorizes.
 *
 * The dispatcher runs the handler, and — on success only — bumps the
 * `user_action_tracker` mastery counter for the verb (best-effort, never
 * fails the execution). It NEVER decides authorization.
 */

import {
  setReminderHandler,
  snoozeReminderHandler,
} from './handlers/reminders.js';
import { createSiteHandler } from './handlers/sites.js';
import { addEmployeeHandler } from './handlers/workforce.js';
import { createLicenceHandler } from './handlers/licences.js';
import { logProductionHandler } from './handlers/production.js';
import { bumpActionMastery } from './mastery-tracker.js';
import type {
  ActionHandler,
  DispatchResult,
  ExecContext,
  RegistryEntry,
} from './types.js';

/**
 * The frozen registry. Each entry pairs the handler with its trust class.
 * `autoSafe` defaults to `false` for safety — a new verb is confirm-
 * required unless it is explicitly marked benign here.
 */
const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({
  set_reminder: { handler: setReminderHandler, autoSafe: true },
  snooze_reminder: { handler: snoozeReminderHandler, autoSafe: true },
  // CONFIRM-REQUIRED domain verbs — real persisted rows. Never auto-safe.
  create_site: { handler: createSiteHandler, autoSafe: false },
  add_employee: { handler: addEmployeeHandler, autoSafe: false },
  create_licence: { handler: createLicenceHandler, autoSafe: false },
  log_production: { handler: logProductionHandler, autoSafe: false },
});

/** Normalise a model / FE verb token for registry lookup. */
function normalizeVerb(verb: string): string {
  return verb.trim().toLowerCase();
}

function lookup(verb: string): RegistryEntry | undefined {
  return REGISTRY[normalizeVerb(verb)];
}

/**
 * TRUE when `verb` is an AUTO-SAFE registry entry. The brain-teach
 * auto-authorized path gates on this so it only auto-executes verbs that
 * are benign enough to run without an explicit human confirmation
 * (reminders). Confirm-required verbs (create_site / add_employee) return
 * FALSE — they keep today's badge-only (executed:false) behaviour there.
 *
 * NOTE: `isSafeVerb` means "auto-safe", NOT "known". Use `isKnownVerb` to
 * test registry membership for the full set.
 */
export function isSafeVerb(verb: string): boolean {
  return lookup(verb)?.autoSafe === true;
}

/**
 * TRUE when `verb` is registered at all (auto-safe OR confirm-required).
 * The `/confirm-action` endpoint can dispatch any known verb (after the
 * gate authorizes it); this is also handy for diagnostics.
 */
export function isKnownVerb(verb: string): boolean {
  return lookup(verb) !== undefined;
}

/**
 * TRUE when `verb` is a KNOWN verb that is CONFIRM-REQUIRED (not
 * auto-safe). The `/micro-action` endpoint uses this to refuse a
 * confirm-required verb up front with `reason:'confirmation_required'`,
 * so an auto-safe surface can never run a domain mutation.
 *
 * An UNKNOWN verb returns FALSE (it is not "confirm-required" — it is
 * simply unknown, and dispatch handles it as `unknown_action`).
 */
export function requiresConfirmation(verb: string): boolean {
  const entry = lookup(verb);
  return entry !== undefined && entry.autoSafe === false;
}

/** The registered AUTO-SAFE verb names — handy for tests + diagnostics. */
export function safeVerbs(): ReadonlyArray<string> {
  return Object.freeze(
    Object.entries(REGISTRY)
      .filter(([, entry]) => entry.autoSafe)
      .map(([verb]) => verb),
  );
}

/** Every registered verb name (auto-safe + confirm-required). */
export function knownVerbs(): ReadonlyArray<string> {
  return Object.freeze(Object.keys(REGISTRY));
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
 * The caller is responsible for BOTH authorization (run
 * `decideAutoAuthorization` first) AND the confirm-required policy: this
 * function will happily run a confirm-required verb if asked, so only the
 * `/confirm-action` path (where the owner explicitly confirmed) should
 * pass one in. The auto-safe surfaces gate on `isSafeVerb` /
 * `requiresConfirmation` before they ever call here.
 */
export async function dispatchAction(
  verb: string,
  params: unknown,
  ctx: ExecContext,
): Promise<DispatchResult> {
  const normalized = normalizeVerb(verb);
  const entry = REGISTRY[normalized];
  if (!entry) {
    return { executed: false, reason: 'unknown_action' };
  }

  const handler: ActionHandler = entry.handler;
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
