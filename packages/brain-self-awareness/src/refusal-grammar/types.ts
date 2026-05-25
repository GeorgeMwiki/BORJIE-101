// Refusal Grammar — types
// A *structured* refusal: never bare prose. Operators see why and what to do.

/**
 * The three classes of refusal we surface to operators.
 *
 * - 'wont': brain chose not to (policy / values / autonomy cap)
 * - 'cant': brain physically cannot (missing tool / data / permissions)
 * - 'uncertain': brain isn't sure enough — operator should decide
 *
 * Distinguishing these prevents the "polite stonewall" failure mode where
 * any "no" looks identical to the user.
 */
export type RefusalClass = 'wont' | 'cant' | 'uncertain'

/**
 * The full refusal payload.
 *
 * `reason_owner_safe` must be safe to show the property owner / tenant — no
 * stack traces, no internal model IDs, no PII of other parties.
 */
export interface Refusal {
  readonly class: RefusalClass
  readonly reason_owner_safe: string
  /** Alternative the brain CAN do — keeps the conversation moving. */
  readonly alternative?: string
  /** Where the operator should send the request next (human role / form). */
  readonly escalation_path?: string
  /** Stable code so UIs can localise without parsing prose. */
  readonly code?: string
}

/**
 * The AG-UI-shaped payload returned from `formatRefusal`.
 *
 * We do NOT import from the real `ag-ui` package — that would couple this
 * core module to a UI lib. Downstream code can map to real AG-UI types.
 */
export interface RefusalCardEnvelope {
  readonly ag_ui_kind: 'refusal_card'
  readonly payload: Refusal
}
