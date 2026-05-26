import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { Bid, BidMessage, Listing, Mineral } from '@/types/listing'

export type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'grade'

export interface ListingFilters {
  readonly mineral?: Mineral
  readonly region?: string
  readonly minGradeNumeric?: number
  readonly maxGradeNumeric?: number
  readonly sort?: SortKey
  readonly search?: string
}

interface ListingsResponse {
  readonly data: readonly Listing[]
}

interface ListingResponse {
  readonly data: Listing
}

export async function fetchListings(filters: ListingFilters = {}): Promise<readonly Listing[]> {
  const response = await apiFetch<ListingsResponse>(`${MINING_PREFIX}/marketplace/listings`, {
    query: {
      mineral: filters.mineral,
      region: filters.region,
      minGrade: filters.minGradeNumeric,
      maxGrade: filters.maxGradeNumeric,
      sort: filters.sort,
      search: filters.search
    }
  })
  return response.data
}

export async function fetchListing(id: string): Promise<Listing | undefined> {
  const response = await apiFetch<ListingResponse>(
    `${MINING_PREFIX}/marketplace/listings/${encodeURIComponent(id)}`
  )
  return response.data
}

export type PaymentTerms = 'instant' | '30d' | '60d'

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
  readonly paymentTerms: PaymentTerms
  readonly notes?: string
}

function toGatewayBidPayload(input: PlaceBidInput): GatewayBidPayload {
  return {
    listingId: input.listingId,
    bidPriceTzs: input.offerTzsPerKg * input.quantityKg,
    paymentTerms: input.paymentTerms,
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
  const response = await apiFetch<{ readonly data: readonly Bid[] }>(`${MINING_PREFIX}/bids`)
  return response.data
}

export async function fetchBid(id: string): Promise<Bid | undefined> {
  const response = await apiFetch<BidResponse>(`${MINING_PREFIX}/bids/${encodeURIComponent(id)}`)
  return response.data
}

export interface SendBidMessageInput {
  readonly bidId: string
  readonly body: string
}

export async function sendBidMessage(input: SendBidMessageInput): Promise<BidMessage> {
  const response = await apiFetch<{ readonly data: BidMessage }>(
    `${MINING_PREFIX}/bids/${encodeURIComponent(input.bidId)}/messages`,
    {
      method: 'POST',
      body: { body: input.body }
    }
  )
  return response.data
}

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
