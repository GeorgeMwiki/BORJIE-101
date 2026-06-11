/**
 * chatActions — workforce-mobile action-bridge client.
 *
 * The ProposedActionCard the brain surfaces in HomeChat used to be
 * render-only: the worker / owner saw a "Borjie suggests …" footer but
 * could not act on it. This module is the real execution path — the
 * SAME generative fulfillment endpoint the owner-web cockpit uses:
 *
 *   POST /api/v1/owner/chat/confirm-action  body { verb, params }
 *     → gateway wraps as { success, data }
 *     → data: { executed, authorized, reason?, result?,
 *               deferToBrain?, verb?, params? }
 *
 * Mirrors apps/owner-web/src/lib/queries/chat-actions.ts so both surfaces
 * consume one envelope. The gateway is the only authorizer — this client
 * adds NO per-verb logic (any verb/params the card carries is forwarded
 * verbatim). SAFE / confirm-cleared verbs execute server-side; an unknown
 * brain-generated verb that clears the hard rails comes back with
 * `deferToBrain:true` so the caller routes it to the brain's agentic turn.
 *
 * Graceful by construction: a 401/403/5xx, a network drop, or a wire
 * drift resolves to `{ executed:false, authorized:false, reason }` rather
 * than throwing into the chat bubble. The caller renders that as a
 * "needs confirmation" / declined note.
 */

import { z } from 'zod'
import { API_BASE_URL } from '../api/config'
import { getAuthToken } from '../auth/session'

const CONFIRM_ACTION_PATH = '/api/v1/owner/chat/confirm-action'

/** Params object forwarded verbatim to the matching brain tool. */
export type ConfirmActionParams = Readonly<Record<string, unknown>>

export interface ConfirmActionRequest {
  readonly verb: string
  readonly params: ConfirmActionParams
}

// The action-bridge response. `executed` and `authorized` are the only
// guaranteed booleans; `reason` explains a decline; `result` is the
// tool's own payload (shape varies by verb). `deferToBrain:true` means
// the verb is not in the deterministic registry but cleared the hard
// rails — the caller routes it to the brain's agentic turn (with the
// echoed verb/params) instead of a dead "needs confirmation" note.
// Unknown extra keys are stripped by zod so a richer future payload
// never rejects.
const confirmActionResultSchema = z.object({
  executed: z.boolean(),
  authorized: z.boolean().default(false),
  reason: z.string().optional(),
  result: z.unknown().optional(),
  deferToBrain: z.boolean().default(false),
  verb: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional()
})

export type ConfirmActionResult = z.infer<typeof confirmActionResultSchema>

// The gateway wraps action-bridge responses as `{ success, data }`. The
// mobile `request` client does not unwrap that envelope, so we peel the
// `data` payload here before zod-parsing it (mirrors owner-web's
// `apiRequest`, which unwraps the same wrapper centrally).
function unwrapEnvelope(raw: unknown): unknown {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'data' in raw &&
    (raw as { readonly success?: unknown }).success === true
  ) {
    return (raw as { readonly data: unknown }).data
  }
  return raw
}

/**
 * Execute a confirmation-card decision. Same envelope owner-web uses; the
 * verb is the card's action verb and the params are its forwarded
 * payload. Resolves to a graceful `{ executed:false, … }` on any
 * unauthorized / network / parse failure rather than throwing.
 */
export async function confirmAction(
  req: ConfirmActionRequest
): Promise<ConfirmActionResult> {
  const url = `${API_BASE_URL}${CONFIRM_ACTION_PATH}`
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ verb: req.verb, params: req.params })
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        executed: false,
        authorized: false,
        deferToBrain: false,
        reason: `confirm-action ${response.status}`
      }
    }
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : {}
    return confirmActionResultSchema.parse(unwrapEnvelope(parsed))
  } catch (error) {
    // A network drop, an aborted request, a JSON / zod drift. Surface a
    // graceful unauthorized result so the card can degrade to a
    // "needs confirmation" note instead of crashing the bubble.
    const reason = error instanceof Error ? error.message : 'request_failed'
    return { executed: false, authorized: false, deferToBrain: false, reason }
  }
}
