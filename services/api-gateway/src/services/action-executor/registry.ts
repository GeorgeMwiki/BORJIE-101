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
 *   set_reminder      — insert an owner reminder           (autoSafe:true)
 *   snooze_reminder   — push a reminder forward             (autoSafe:true)
 *   create_site       — insert a physical mining site       (autoSafe:false)
 *   add_employee      — insert a workforce HR record        (autoSafe:false)
 *   create_licence    — insert a mining licence/title       (autoSafe:false)
 *   log_production    — insert a production output record   (autoSafe:false)
 *   draft_payroll_run — insert a `payroll_runs` DRAFT header (autoSafe:false)
 *   draft_royalty_return — insert a `royalty_return_drafts`
 *                          DRAFT header                      (autoSafe:false)
 *   open_support_case / resolve_support_case / escalate_to_human
 *                        — Mr. Mwikila's support-case lifecycle (autoSafe:false)
 *   update_site / update_employee / update_licence / update_production /
 *   update_reminder      — NON-MONEY EDITS of an existing row (autoSafe:false)
 *   archive_site / remove_employee / void_licence / delete_production /
 *   cancel_reminder      — SOFT-delete (status flip / voided marker)(autoSafe:false)
 *   manage_tab           — SERVER-PERSISTED tab structure ops
 *                          (spawn|update|remove|reorder|pin)     (autoSafe:false)
 *
 * The UPDATE + DELETE/ARCHIVE verbs complete the "Mr. Mwikila can do anything
 * from chat" claim: the create/add/log verbs already INSERT; these EDIT and
 * REMOVE. Every one is NON-MONEY by construction (no wage / fee / ledger column
 * is ever written; production_records has no money column at all) and every
 * delete is a SOFT-delete that preserves the row + audit trail. `manage_tab`
 * promotes tab structure from FE-chip-only to a durable per-row store
 * (`owner_tabs_structural`, migration 0169). See handlers/updates.ts,
 * handlers/deletes.ts, handlers/tabs.ts.
 *
 * Money-MOVING verbs (post the ledger / commit wages) are intentionally
 * NOT here — they MUST go through `LedgerService.post()` (CLAUDE.md hard
 * rule) and need four-eye flows; they land in a later wave. See the
 * DEFERRED MONEY VERBS block below for the precise list + rationale.
 *
 * `draft_payroll_run` + `draft_royalty_return` are the money-ADJACENT verbs
 * here, and both are non-binding DRAFTS, NOT money moves:
 *   - draft_payroll_run creates only the `payroll_runs` header row in its
 *     initial `status='draft'` state (no wage figures, no line items,
 *     total_tzs/worker_count left at their DB defaults). The owner approves
 *     it elsewhere; only a SEPARATE preview→commit endpoint calls
 *     LedgerService.post(). See handlers/payroll-draft.ts.
 *   - draft_royalty_return creates only a `royalty_return_drafts` header in
 *     `status='draft'`. That table (migration 0159) carries NO posted money /
 *     ledger column AT ALL — gross_value / royalty_amount are filled by the
 *     owner in the royalty surface, NEVER from chat, and the royalty PAYMENT
 *     posts via LedgerService.post() on the SEPARATE four-eye `file_royalty`
 *     flow (DEFERRED below). See handlers/royalty-draft.ts.
 * Both import NO LedgerService and write NO ledger row.
 *
 * The confirm-required domain verbs above are NON-MONEY by construction:
 *   - sites carry no money column.
 *   - employees carry one (`wage_rate_tzs`) that is DELIBERATELY left unset
 *     (see handlers/workforce.ts).
 *   - licences carry only a `fees` jsonb, left at its `{}` DB default — no
 *     fee/royalty figure is written (see handlers/licences.ts).
 *   - production_records carry NO money column at all (mass/grade only —
 *     see handlers/production.ts).
 *   - payroll_runs (DRAFT) DO carry money columns (`total_tzs`,
 *     `worker_count`), but draft_payroll_run leaves BOTH at their DB
 *     defaults ('0' / 0), creates NO `payroll_line_items` (the wage rows),
 *     and stops at `status='draft'` — the pre-money state. The wage figures
 *     are computed by a SEPARATE preview step and posted ONLY by a SEPARATE
 *     commit step via LedgerService.post() (see handlers/payroll-draft.ts).
 *   - royalty_return_drafts carry NO money column at all (no gross_value /
 *     royalty_amount / ledger_txn_id — migration 0159). draft_royalty_return
 *     writes only period + mineral + an OPTIONAL non-money physical
 *     quantity/unit and stops at `status='draft'`. The royalty FIGURES are
 *     filled by the owner in the royalty surface and the PAYMENT posts via
 *     LedgerService.post() on the four-eye `file_royalty` flow (DEFERRED) —
 *     never here (see handlers/royalty-draft.ts).
 * So all of these use their domain repos directly (no LedgerService).
 *
 * ─── DEFERRED MONEY-MOVING VERBS (NOT registered — do NOT add here) ─────
 * The following verbs were explicitly considered and DEFERRED. They each
 * MOVE money (post the ledger / commit wages) and therefore MUST be routed
 * through `LedgerService.post()` in `services/payments-ledger/` (the
 * immutable double-entry invariant — CLAUDE.md hard rule), behind the
 * relevant four-eye / policy flow. Registering them here as plain domain
 * inserts would bypass the ledger and is FORBIDDEN. They will land in a
 * dedicated money-actions wave that calls LedgerService — not here.
 *
 *   file_royalty  — POSTS a royalty liability/payment → MUST debit/credit
 *                   the ledger (royalty money obligation, not a note).
 *                   NOTE: distinct from `draft_royalty_return`, which is the
 *                   registered NON-MONEY DRAFT (header-only) verb that writes
 *                   no money figure; file_royalty is the money move and stays
 *                   DEFERRED to the LedgerService-backed wave.
 *   set_payroll   — sets/COMMITS payroll figures → wage money path; goes
 *                   through payroll-runs commit + LedgerService, never a raw
 *                   insert. NOTE: distinct from `draft_payroll_run`, which
 *                   is the registered non-money DRAFT (header-only) verb.
 *   post_ledger   — by definition a ledger posting → the ONLY legal path is
 *                   LedgerService.post(); never a direct write from chat.
 *
 * ─── draft_royalty_return (NOW REGISTERED — NON-MONEY DRAFT) ────────────
 * Previously FLAGGED "no backing table". The royalty-draft wave landed the
 * table: `royalty_return_drafts` (migration 0159 + the
 * royalty-return-drafts.schema.ts Drizzle schema), RLS FORCE-enabled exactly
 * like payroll_runs (0134 §4). The verb is now registered below as the
 * royalty sibling of draft_payroll_run: a CONFIRM-REQUIRED, NON-MONEY DRAFT
 * that inserts a `status='draft'` header the owner reviews + completes in the
 * royalty surface (apps/owner-web RoyaltyDraftPanel).
 *
 * Crucially, `royalty_return_drafts` carries NO posted money / ledger column
 * AT ALL (no gross_value, no royalty_amount, no ledger_txn_id). The royalty
 * FIGURES are filled by the owner in the royalty surface, NEVER from chat,
 * and the royalty PAYMENT still posts the money path through
 * `LedgerService.post()` on the SEPARATE four-eye `file_royalty` flow (DEFERRED
 * above). draft_royalty_return imports NO LedgerService and writes NO ledger
 * row (see handlers/royalty-draft.ts). This is distinct from the money-MOVING
 * `file_royalty` verb, which remains DEFERRED.
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
import { draftPayrollRunHandler } from './handlers/payroll-draft.js';
import { draftRoyaltyReturnHandler } from './handlers/royalty-draft.js';
import {
  openSupportCaseHandler,
  resolveSupportCaseHandler,
  escalateToHumanHandler,
} from './handlers/support.js';
import {
  updateSiteHandler,
  updateEmployeeHandler,
  updateLicenceHandler,
  updateProductionHandler,
  updateReminderHandler,
} from './handlers/updates.js';
import {
  archiveSiteHandler,
  removeEmployeeHandler,
  voidLicenceHandler,
  deleteProductionHandler,
  cancelReminderHandler,
} from './handlers/deletes.js';
import { manageTabHandler } from './handlers/tabs.js';
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
  // CONFIRM-REQUIRED non-money DRAFT verb — creates only a `payroll_runs`
  // header in `status='draft'` (no wage money, no ledger). Never auto-safe.
  draft_payroll_run: { handler: draftPayrollRunHandler, autoSafe: false },
  // CONFIRM-REQUIRED non-money DRAFT verb — creates only a
  // `royalty_return_drafts` header in `status='draft'`. That table has NO
  // money/ledger column at all; the royalty figures + payment are filled by
  // the owner elsewhere (LedgerService four-eye flow). Never auto-safe.
  draft_royalty_return: { handler: draftRoyaltyReturnHandler, autoSafe: false },
  // ─── SUPPORT verbs (NON-MONEY) — Mr. Mwikila's first-line-support actions ──
  // None touch the money path; `support_cases` has NO money column. All three
  // are CONFIRM-REQUIRED (durable support-case writes): open persists a new
  // case the MD remembers forever; resolve closes it (= confirm); escalate
  // hands the case to a human (always-authorized in spirit, but still gated +
  // RECORDED in the immutable audit chain — never silent). See handlers/support.ts.
  open_support_case: { handler: openSupportCaseHandler, autoSafe: false },
  resolve_support_case: { handler: resolveSupportCaseHandler, autoSafe: false },
  escalate_to_human: { handler: escalateToHumanHandler, autoSafe: false },
  // ─── UPDATE verbs (NON-MONEY edits) — the "MD can EDIT anything" half ──────
  // Each patches an existing domain row, tenant-scoped (WHERE tenant_id=ctx AND
  // id=…), audit-chained. NONE touch a money column (wage/fees/ledger are never
  // written; production carries no money column). All CONFIRM-REQUIRED. See
  // handlers/updates.ts.
  update_site: { handler: updateSiteHandler, autoSafe: false },
  update_employee: { handler: updateEmployeeHandler, autoSafe: false },
  update_licence: { handler: updateLicenceHandler, autoSafe: false },
  update_production: { handler: updateProductionHandler, autoSafe: false },
  update_reminder: { handler: updateReminderHandler, autoSafe: false },
  // ─── DELETE / ARCHIVE verbs (SOFT-delete) — the "MD can REMOVE anything" half
  // Each SOFT-deletes (status flip / voided marker) so the row + audit survive;
  // tenant-scoped + audit-chained. NONE touch a money column. All CONFIRM-
  // REQUIRED. See handlers/deletes.ts.
  archive_site: { handler: archiveSiteHandler, autoSafe: false },
  remove_employee: { handler: removeEmployeeHandler, autoSafe: false },
  void_licence: { handler: voidLicenceHandler, autoSafe: false },
  delete_production: { handler: deleteProductionHandler, autoSafe: false },
  cancel_reminder: { handler: cancelReminderHandler, autoSafe: false },
  // ─── SERVER-PERSISTED TABS — durable structural store (migration 0169) ────
  // manage_tab (op: spawn|update|remove|reorder|pin) writes
  // `owner_tabs_structural` directly so tab structure PERSISTS server-side
  // instead of FE-chip-only. Pure UI structure — NO money column. CONFIRM-
  // REQUIRED. See handlers/tabs.ts.
  manage_tab: { handler: manageTabHandler, autoSafe: false },
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
