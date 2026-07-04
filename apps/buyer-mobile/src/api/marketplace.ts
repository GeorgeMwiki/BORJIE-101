import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import { mapListing, type RawListingRow } from './listing-adapter'
import {
  mapGatewayBid,
  type GatewayBidListing,
  type GatewayBidRow
} from './bid-adapter'
import type {
  Bid,
  Listing,
  MarketplaceSeller,
  Mineral
} from '@/types/listing'

export { mapListing } from './listing-adapter'
export { mapGatewayBid } from './bid-adapter'

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
