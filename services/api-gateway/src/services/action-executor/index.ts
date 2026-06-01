/**
 * action-executor — the chat→action execution bridge.
 *
 * Public surface:
 *   - dispatchAction(verb, params, ctx) — run a SAFE verb's handler,
 *     bump mastery on success. Caller MUST authorize first.
 *   - isSafeVerb(verb) / safeVerbs() — the SAFE registry membership the
 *     brain-teach auto-execute path gates on.
 *   - types — ExecContext / ExecResult / DispatchResult.
 *
 * See ./registry.ts for the SAFE verb set and the hard-rule rationale
 * (money / ledger / hire / licence verbs are intentionally excluded).
 */

export {
  dispatchAction,
  isSafeVerb,
  safeVerbs,
} from './registry.js';

export type {
  ActionHandler,
  DispatchResult,
  ExecContext,
  ExecDbClient,
  ExecLogger,
  ExecResult,
} from './types.js';
