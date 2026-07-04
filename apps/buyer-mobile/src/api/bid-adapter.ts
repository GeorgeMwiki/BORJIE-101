import type { Bid, BidStatus, Mineral } from '@/types/listing'

/**
 * Pure gateway-bid adapter. Kept in its own React-Native-free module (no
 * `./client` / SecureStore imports) so it is unit-testable under the
 * node/rollup vitest rig — the same split `listing-adapter.ts` uses.
 * `marketplace.ts` re-exports `mapGatewayBid` and applies it in the
 * bid fetchers.
 */

/**
 * Wire shape of a `marketplace_bids` row as the api-gateway returns it
 * (numeric columns are string-encoded; the message thread is served by
 * the bid-messaging surface, not embedded here). Mirrors `BidSchema` in
 * services/api-gateway/src/routes/mining/_openapi/bid-schemas.ts.
 *
 * `rfbResponseId` is present when the bid was raised via the RFB counter-
 * offer flow and links directly to the `request_for_bid_responses` row
 * that the bid-messaging surface keys on. It is null for pure marketplace
 * bids that carry no chat thread.
 */
export interface GatewayBidRow {
  readonly id: string
  readonly listingId: string
  readonly bidPriceTzs: string
  readonly status: string
  readonly createdAt: string
  /** rfb_responses.id — present only for RFB-linked bids. */
  readonly rfbResponseId?: string | null
}

/** Listing summary joined to a single bid by GET /bids/:id. */
export interface GatewayBidListing {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly priceTzs: string | null
  readonly attributes: Record<string, unknown> | null
}

const BID_STATUSES: readonly BidStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'countered',
  'withdrawn',
]

function coerceStatus(raw: string): BidStatus {
  return BID_STATUSES.includes(raw as BidStatus) ? (raw as BidStatus) : 'pending'
}

function attrNumber(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): number {
  const value = attributes?.[key]
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function attrString(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const value = attributes?.[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Map a gateway bid row (+ optional listing join) into the FE `Bid`
 * shape the bids screens render. The bid persists only the *total*
 * `bidPriceTzs`; per-kg + quantity are reconstructed from the listing
 * `attributes.quantityKg` ONLY when a real quantity is present
 * (total ÷ quantity). When the listing carries NO quantity (a legit
 * gateway state), BOTH per-kg and quantity are `null` — never the total
 * mislabeled as a per-kg price and never a fabricated 1 kg parcel; the
 * render shows the honest "TZS —" / "— kg" placeholders. The message
 * thread is loaded separately via `@/api/bid-messaging`, so `thread`
 * is empty.
 */
export function mapGatewayBid(row: GatewayBidRow, listing?: GatewayBidListing): Bid {
  const total = Number(row.bidPriceTzs)
  const safeTotal = Number.isFinite(total) ? total : 0
  // 0 = the attribute is absent (attrNumber returns 0 for missing/non-positive).
  // Without a real quantity we CANNOT derive a per-kg price — leave both null.
  const rawQuantityKg = attrNumber(listing?.attributes, 'quantityKg')
  const hasQuantity = rawQuantityKg > 0
  const quantityKg = hasQuantity ? rawQuantityKg : null
  const offerTzsPerKg = hasQuantity ? safeTotal / rawQuantityKg : null
  const mineral = attrString(listing?.attributes, 'mineral') as Mineral
  // Expose the RFB-response thread key when the gateway returns it so
  // bids/[id].tsx can pass the correct id to the bid-messaging surface.
  // Null means this is a pure marketplace bid with no chat thread.
  const threadResponseId =
    typeof row.rfbResponseId === 'string' && row.rfbResponseId.length > 0
      ? row.rfbResponseId
      : null
  return {
    id: row.id,
    listingId: row.listingId,
    listingTitle: listing?.title ?? '',
    mineral,
    offerTzsPerKg,
    quantityKg,
    bidTotalTzs: safeTotal,
    status: coerceStatus(row.status),
    placedAt: row.createdAt,
    thread: [],
    threadResponseId,
  }
}
