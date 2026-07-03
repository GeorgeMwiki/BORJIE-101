import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import { mapListing, type RawListingRow } from './listing-adapter'
import type {
  Bid,
  BidStatus,
  Listing,
  MarketplaceSeller,
  Mineral
} from '@/types/listing'

export { mapListing } from './listing-adapter'

export type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'grade'

export interface ListingFilters {
  readonly mineral?: Mineral
  readonly region?: string
  readonly minGradeNumeric?: number
  readonly maxGradeNumeric?: number
  readonly sort?: SortKey
  readonly search?: string
  /**
   * Owner-scoped browse — restrict to one mine's buyer-visible active
   * listings ("buy from this mine"). The gateway never exposes a
   * private listing through this filter.
   */
  readonly sellerTenantId?: string
}

interface SellersResponse {
  readonly data: readonly MarketplaceSeller[]
}

export async function fetchListings(filters: ListingFilters = {}): Promise<readonly Listing[]> {
  const response = await apiFetch<{ readonly data: readonly RawListingRow[] }>(
    `${MINING_PREFIX}/marketplace/listings`,
    {
      query: {
        mineral: filters.mineral,
        region: filters.region,
        minGrade: filters.minGradeNumeric,
        maxGrade: filters.maxGradeNumeric,
        sort: filters.sort,
        search: filters.search,
        sellerTenantId: filters.sellerTenantId
      }
    }
  )
  return response.data.map(mapListing)
}

/**
 * The distinct seller orgs (mines) that currently have buyer-visible
 * active listings — backs the "browse by mine" entry. Private listings
 * are never counted (gateway guard).
 */
export async function fetchSellers(): Promise<readonly MarketplaceSeller[]> {
  const response = await apiFetch<SellersResponse>(
    `${MINING_PREFIX}/marketplace/listings/sellers`
  )
  return response.data
}

export async function fetchListing(id: string): Promise<Listing | undefined> {
  const response = await apiFetch<{ readonly data: RawListingRow | null }>(
    `${MINING_PREFIX}/marketplace/listings/${encodeURIComponent(id)}`
  )
  return response.data ? mapListing(response.data) : undefined
}

export type PaymentTerms = 'instant' | '30d' | '60d'

/**
 * Wire vocabulary the api-gateway `PaymentTermsEnum`
 * (services/api-gateway/src/routes/mining/_openapi/bid-schemas.ts) accepts.
 * The buyer UI speaks `'30d' | '60d'`; the gateway speaks `'net_30' |
 * 'net_60'`. This is the single translation point — never POST the UI
 * vocabulary straight through.
 */
type WirePaymentTerms = 'instant' | 'net_30' | 'net_60'

const WIRE_PAYMENT_TERMS: Readonly<Record<PaymentTerms, WirePaymentTerms>> = {
  instant: 'instant',
  '30d': 'net_30',
  '60d': 'net_60'
}

export interface PlaceBidInput {
  readonly listingId: string
  readonly offerTzsPerKg: number
  readonly quantityKg: number
  readonly paymentTerms: PaymentTerms
  readonly notes?: string
  readonly termsAccepted: boolean
}

interface BidResponse {
  readonly data: Bid
}

/**
 * Payload shape the api-gateway expects for POST /api/v1/mining/bids.
 * Mirrors `PlaceBidSchema` in services/api-gateway/src/routes/mining/bids.hono.ts.
 * The buyer enters a per-kg price; we surface a total `bidPriceTzs` so the
 * gateway has a single canonical number to validate and persist.
 */
interface GatewayBidPayload {
  readonly listingId: string
  readonly bidPriceTzs: number
  readonly paymentTerms: WirePaymentTerms
  readonly notes?: string
}

function toGatewayBidPayload(input: PlaceBidInput): GatewayBidPayload {
  return {
    listingId: input.listingId,
    bidPriceTzs: input.offerTzsPerKg * input.quantityKg,
    paymentTerms: WIRE_PAYMENT_TERMS[input.paymentTerms],
    notes: input.notes && input.notes.length > 0 ? input.notes : undefined
  }
}

export async function placeBid(input: PlaceBidInput): Promise<Bid> {
  const response = await apiFetch<BidResponse>(`${MINING_PREFIX}/bids`, {
    method: 'POST',
    body: toGatewayBidPayload(input)
  })
  return response.data
}

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
interface GatewayBidRow {
  readonly id: string
  readonly listingId: string
  readonly bidPriceTzs: string
  readonly status: string
  readonly createdAt: string
  /** rfb_responses.id — present only for RFB-linked bids. */
  readonly rfbResponseId?: string | null
}

/** Listing summary joined to a single bid by GET /bids/:id. */
interface GatewayBidListing {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly priceTzs: string | null
  readonly attributes: Record<string, unknown> | null
}

const BID_STATUSES: readonly BidStatus[] = ['pending', 'accepted', 'rejected', 'countered', 'withdrawn']

function coerceStatus(raw: string): BidStatus {
  return BID_STATUSES.includes(raw as BidStatus) ? (raw as BidStatus) : 'pending'
}

function attrNumber(attributes: Record<string, unknown> | null | undefined, key: string): number {
  const value = attributes?.[key]
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function attrString(attributes: Record<string, unknown> | null | undefined, key: string): string {
  const value = attributes?.[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Map a gateway bid row (+ optional listing join) into the FE `Bid`
 * shape the bids screens render. The bid persists only the *total*
 * `bidPriceTzs`; per-kg + quantity are reconstructed from the listing
 * `attributes.quantityKg` when present (total ÷ quantity), falling back
 * to the total so the figure is never silently wrong. The message thread
 * is loaded separately via `@/api/bid-messaging`, so `thread` is empty.
 */
function mapGatewayBid(row: GatewayBidRow, listing?: GatewayBidListing): Bid {
  const total = Number(row.bidPriceTzs)
  const safeTotal = Number.isFinite(total) ? total : 0
  const quantityKg = attrNumber(listing?.attributes, 'quantityKg')
  const offerTzsPerKg = quantityKg > 0 ? safeTotal / quantityKg : safeTotal
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
    quantityKg: quantityKg > 0 ? quantityKg : 1,
    status: coerceStatus(row.status),
    placedAt: row.createdAt,
    thread: [],
    threadResponseId,
  }
}

export async function fetchBids(): Promise<readonly Bid[]> {
  const response = await apiFetch<{ readonly data: readonly GatewayBidRow[] }>(
    `${MINING_PREFIX}/bids/mine`
  )
  return response.data.map((row) => mapGatewayBid(row))
}

interface GatewayBidDetailResponse {
  readonly data: {
    readonly bid: GatewayBidRow
    readonly listing: GatewayBidListing
  }
}

export async function fetchBid(id: string): Promise<Bid | undefined> {
  const response = await apiFetch<GatewayBidDetailResponse>(
    `${MINING_PREFIX}/bids/${encodeURIComponent(id)}`
  )
  if (!response.data) {
    return undefined
  }
  return mapGatewayBid(response.data.bid, response.data.listing)
}

// NOTE: bid messaging is served exclusively by the canonical
// /api/v1/mining/bid-messaging/threads/:responseId/messages surface
// (see src/api/bid-messaging.ts → sendThreadMessage). The legacy
// /bids/:id/messages route never existed on the gateway, so the old
// `sendBidMessage` here always 404'd; it has been removed. The chat
// screen resolves a bid's `threadResponseId` and uses the thread surface.

export type BidAction = 'accept' | 'withdraw'

export async function updateBidStatus(input: {
  readonly bidId: string
  readonly action: BidAction
}): Promise<Bid | undefined> {
  const response = await apiFetch<BidResponse>(
    `${MINING_PREFIX}/bids/${encodeURIComponent(input.bidId)}/${input.action}`,
    { method: 'POST' }
  )
  return response.data
}
