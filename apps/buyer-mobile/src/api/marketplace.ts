import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import { withMockFallback } from './withFallback'
import { mockListings, findListing } from '@/mocks/listings'
import { mockBids, findBid } from '@/mocks/bids'
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

// Extract a numeric grade value from labels like "42 g/t Au", "32% Ta2O5"
function gradeNumeric(grade: string): number {
  const match = grade.match(/(\d+(?:\.\d+)?)/)
  return match && match[1] ? Number(match[1]) : 0
}

function applyFilters(listings: readonly Listing[], filters: ListingFilters): readonly Listing[] {
  return listings
    .filter((l) => (filters.mineral ? l.mineral === filters.mineral : true))
    .filter((l) => (filters.region ? l.originRegion.toLowerCase().includes(filters.region.toLowerCase()) : true))
    .filter((l) => {
      const value = gradeNumeric(l.grade)
      if (filters.minGradeNumeric !== undefined && value < filters.minGradeNumeric) {
        return false
      }
      if (filters.maxGradeNumeric !== undefined && value > filters.maxGradeNumeric) {
        return false
      }
      return true
    })
    .filter((l) => {
      if (!filters.search) {
        return true
      }
      const needle = filters.search.toLowerCase()
      return (
        l.title.toLowerCase().includes(needle) ||
        l.originRegion.toLowerCase().includes(needle) ||
        l.seller.name.toLowerCase().includes(needle)
      )
    })
}

function applySort(listings: readonly Listing[], sort: SortKey | undefined): readonly Listing[] {
  if (!sort) {
    return listings
  }
  const copy = [...listings]
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
    case 'price_asc':
      return copy.sort((a, b) => a.priceTzsPerKg - b.priceTzsPerKg)
    case 'price_desc':
      return copy.sort((a, b) => b.priceTzsPerKg - a.priceTzsPerKg)
    case 'grade':
      return copy.sort((a, b) => gradeNumeric(b.grade) - gradeNumeric(a.grade))
    default:
      return copy
  }
}

export async function fetchListings(filters: ListingFilters = {}): Promise<readonly Listing[]> {
  return withMockFallback(
    async () => {
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
    },
    () => applySort(applyFilters(mockListings, filters), filters.sort)
  )
}

export async function fetchListing(id: string): Promise<Listing | undefined> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<ListingResponse>(
        `${MINING_PREFIX}/marketplace/listings/${encodeURIComponent(id)}`
      )
      return response.data
    },
    () => findListing(id)
  )
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
  return withMockFallback(
    async () => {
      const response = await apiFetch<BidResponse>(`${MINING_PREFIX}/bids`, {
        method: 'POST',
        body: toGatewayBidPayload(input)
      })
      return response.data
    },
    () => {
      const listing = findListing(input.listingId)
      const id = `bid-local-${Date.now()}`
      return {
        id,
        listingId: input.listingId,
        listingTitle: listing?.title ?? 'Parcel',
        mineral: listing?.mineral ?? 'gold_concentrate',
        offerTzsPerKg: input.offerTzsPerKg,
        quantityKg: input.quantityKg,
        status: 'pending',
        placedAt: new Date().toISOString(),
        thread: [
          {
            id: `${id}-m1`,
            from: 'buyer',
            body: input.notes ?? 'Offer placed',
            sentAt: new Date().toISOString()
          }
        ]
      }
    }
  )
}

export async function fetchBids(): Promise<readonly Bid[]> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: readonly Bid[] }>(`${MINING_PREFIX}/bids`)
      return response.data
    },
    () => mockBids
  )
}

export async function fetchBid(id: string): Promise<Bid | undefined> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<BidResponse>(`${MINING_PREFIX}/bids/${encodeURIComponent(id)}`)
      return response.data
    },
    () => findBid(id)
  )
}

export interface SendBidMessageInput {
  readonly bidId: string
  readonly body: string
}

export async function sendBidMessage(input: SendBidMessageInput): Promise<BidMessage> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: BidMessage }>(
        `${MINING_PREFIX}/bids/${encodeURIComponent(input.bidId)}/messages`,
        {
          method: 'POST',
          body: { body: input.body }
        }
      )
      return response.data
    },
    () => ({
      id: `msg-local-${Date.now()}`,
      from: 'buyer',
      body: input.body,
      sentAt: new Date().toISOString()
    })
  )
}

export type BidAction = 'accept' | 'withdraw'

export async function updateBidStatus(input: { readonly bidId: string; readonly action: BidAction }): Promise<Bid | undefined> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<BidResponse>(
        `${MINING_PREFIX}/bids/${encodeURIComponent(input.bidId)}/${input.action}`,
        { method: 'POST' }
      )
      return response.data
    },
    () => {
      const existing = findBid(input.bidId)
      if (!existing) {
        return undefined
      }
      return {
        ...existing,
        status: input.action === 'accept' ? 'accepted' : 'rejected'
      }
    }
  )
}
