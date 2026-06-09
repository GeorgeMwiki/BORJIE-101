/**
 * actionFulfillment — pure bridge between a ProposedActionCard and the
 * action-bridge envelope.
 *
 * Two pure functions, no React, no fetch — exercised cold by vitest
 * (node env, no RN renderer) exactly like `chatTurns.ts`:
 *
 *   • `buildConfirmRequest(action)` derives the GENERATIVE `{ verb, params }`
 *     the gateway expects from whatever the card carries. The mobile
 *     ProposedAction wire shape carries `{ verb, object }`, so `object`
 *     is forwarded verbatim as a param — no per-verb switch, any verb the
 *     brain emits flows through untouched.
 *
 *   • `interpretResult(result)` maps the action-bridge envelope to a UI
 *     outcome IDENTICALLY to owner-web's `reflectActionResult`:
 *       executed          → 'executed'      (success note)
 *       deferToBrain       → 'deferToBrain'  (route to the brain's turn)
 *       !authorized+reason → 'needsConfirmation'
 *       otherwise          → 'declined'
 *
 * Keeping this pure means the card stays a thin glue around setState and
 * the network call, and CI can assert the envelope routing without a
 * renderer.
 */

import type { ConfirmActionRequest, ConfirmActionResult } from './chatActions'
import type { ProposedAction } from './types'

/**
 * Derive the generative `{ verb, params }` the action-bridge expects from
 * a ProposedActionCard. The card's `object` (the brain's target selector,
 * e.g. `incident:safety`) is forwarded verbatim as a param so ANY verb
 * the brain proposes is fulfillable — this is the universal contract, not
 * a per-verb mapping.
 */
export function buildConfirmRequest(action: ProposedAction): ConfirmActionRequest {
  return {
    verb: action.verb,
    params: { object: action.object }
  }
}

export type FulfillmentOutcome =
  | { readonly kind: 'executed'; readonly result: unknown }
  | { readonly kind: 'deferToBrain'; readonly verb: string; readonly params: Readonly<Record<string, unknown>> }
  | { readonly kind: 'needsConfirmation'; readonly reason: string }
  | { readonly kind: 'declined'; readonly reason?: string }

/**
 * Map an action-bridge envelope to a render outcome. Mirrors owner-web's
 * `reflectActionResult` branch-for-branch so both surfaces behave the
 * same: executed wins, then deferToBrain, then a reasoned decline, then a
 * bare decline fallback.
 */
export function interpretResult(
  action: ProposedAction,
  result: ConfirmActionResult
): FulfillmentOutcome {
  if (result.executed) {
    return { kind: 'executed', result: result.result }
  }
  if (result.deferToBrain) {
    // Prefer the verb/params the gateway echoed back (canonicalised), but
    // fall back to what the card carried so the brain still gets a target.
    return {
      kind: 'deferToBrain',
      verb: result.verb ?? action.verb,
      params: result.params ?? { object: action.object }
    }
  }
  if (!result.authorized && result.reason) {
    return { kind: 'needsConfirmation', reason: result.reason }
  }
  return result.reason !== undefined
    ? { kind: 'declined', reason: result.reason }
    : { kind: 'declined' }
}

/**
 * Build the structured fulfillment turn sent to the brain when an action
 * defers (`deferToBrain`). Phrasing the action + its params as a plain
 * turn lets the brain that emitted the dynamic verb fulfill it
 * agentically. Bilingual per the CLAUDE.md single-language rule.
 */
export function buildFulfillmentTurn(
  verb: string,
  params: Readonly<Record<string, unknown>>,
  lang: 'sw' | 'en'
): string {
  const target =
    typeof params['object'] === 'string' && (params['object'] as string).length > 0
      ? String(params['object'])
      : ''
  const verbPhrase = target.length > 0 ? `${verb} ${target}` : verb
  return lang === 'sw'
    ? `Tafadhali kamilisha kitendo: ${verbPhrase}`
    : `Please carry out this action: ${verbPhrase}`
}
