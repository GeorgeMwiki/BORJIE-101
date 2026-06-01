/**
 * action-executor — the chat→action execution bridge.
 *
 * Public surface:
 *   - dispatchAction(verb, params, ctx) — run a registered verb's handler,
 *     bump mastery on success. Caller MUST authorize first (and only the
 *     confirm-action path may dispatch a confirm-required verb).
 *   - isSafeVerb(verb) / safeVerbs() — AUTO-SAFE membership the
 *     brain-teach auto-execute path gates on (reminders only).
 *   - isKnownVerb(verb) / knownVerbs() — full registry membership.
 *   - requiresConfirmation(verb) — TRUE for a known CONFIRM-REQUIRED verb
 *     (create_site / add_employee / create_licence / log_production); the
 *     `/micro-action` endpoint uses it to refuse those up front.
 *   - types — ExecContext / ExecResult / DispatchResult / RegistryEntry.
 *
 * See ./registry.ts for the verb set + trust classes and the hard-rule
 * rationale (money / ledger / royalty / payroll verbs are excluded and
 * DEFERRED to a LedgerService-backed wave; sites + employees + licences +
 * production records are confirm-required NON-money rows, never auto-safe).
 */

export {
  dispatchAction,
  isSafeVerb,
  isKnownVerb,
  requiresConfirmation,
  safeVerbs,
  knownVerbs,
} from './registry.js';

export type {
  ActionHandler,
  DispatchResult,
  ExecContext,
  ExecDbClient,
  ExecLogger,
  ExecResult,
  RegistryEntry,
} from './types.js';
