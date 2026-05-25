// formatRefusal — wraps a Refusal in the AG-UI envelope shape.

import type { Refusal, RefusalCardEnvelope } from './types.js'

/**
 * Wraps a Refusal into an AG-UI-shaped envelope so the UI can render it as a
 * structured card. We return a *plain* object — no imports from ag-ui.
 *
 * The returned object is immutable-style: a new object is allocated every call.
 * The payload is the same Refusal instance the caller passed (Refusals are
 * already `readonly`).
 */
export function formatRefusal(refusal: Refusal): RefusalCardEnvelope {
  return {
    ag_ui_kind: 'refusal_card',
    payload: refusal
  }
}
