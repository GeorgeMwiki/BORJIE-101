/**
 * Pure wire-shaping for the KI-007 cross-tenant inquiry surface.
 *
 * Kept free of `@/api/client` (which pulls expo-secure-store and trips the
 * vitest rollup parser) so the body shape + row mapping are unit-testable
 * directly — same constraint as src/marketplace/threadMessages.ts.
 */

export interface RaiseInquiryInput {
  readonly listingId: string
  readonly message: string
}

/**
 * The EXACT body the gateway `raiseInquirySchema` accepts — { listingId,
 * message }, both non-empty. The single translation point; never POST a
 * wider shape (the gateway 400s on empty/unknown fields).
 */
export interface GatewayRaiseInquiryPayload {
  readonly listingId: string
  readonly message: string
}

export function toRaiseInquiryPayload(
  input: RaiseInquiryInput,
): GatewayRaiseInquiryPayload {
  return {
    listingId: input.listingId,
    message: input.message.trim(),
  }
}

/**
 * One of the buyer's own inquiries. The seller owns the underlying
 * flow_run; the buyer sees the response ONLY once it is delivered
 * (`answered` true) — the gateway nulls the response otherwise.
 */
export interface BuyerInquiry {
  readonly id: string
  readonly state: string
  readonly subjectRef: string | null
  readonly listingTitle: string | null
  readonly message: string | null
  readonly answered: boolean
  readonly response: string | null
  readonly createdAt: string | null
}

/** Raw `runView` row shape as buyerInquiriesRouter serializes it. */
export interface GatewayInquiryRow {
  readonly id: string
  readonly state: string
  readonly subjectRef?: string | null
  readonly payload?: {
    readonly message?: string | null
    readonly listingTitle?: string | null
  } | null
  readonly response?: { readonly message?: string | null } | null
  readonly answered?: boolean
  readonly createdAt?: string | null
}

export function mapBuyerInquiry(row: GatewayInquiryRow): BuyerInquiry {
  const payload = row.payload ?? {}
  const answered = row.answered === true
  return {
    id: row.id,
    state: row.state,
    subjectRef: row.subjectRef ?? null,
    listingTitle: payload.listingTitle ?? null,
    message: payload.message ?? null,
    answered,
    // Defense-in-depth: only surface a response when the row is delivered,
    // mirroring the gateway's own gate.
    response: answered ? row.response?.message ?? null : null,
    createdAt: row.createdAt ?? null,
  }
}
