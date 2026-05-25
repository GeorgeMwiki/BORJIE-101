export type Mineral =
  | 'gold_concentrate'
  | 'tanzanite_rough'
  | 'coltan'
  | 'copper_concentrate'
  | 'gemstone_mixed'
  | 'gold_dore'
  | 'tin_cassiterite'
  | 'silver_concentrate'

export interface Seller {
  readonly id: string
  readonly name: string
  readonly pmlNumber: string
  readonly rating: number
  readonly verified: boolean
}

export interface AssayResult {
  readonly element: string
  readonly grade: string
  readonly method: string
}

export interface Listing {
  readonly id: string
  readonly mineral: Mineral
  readonly title: string
  readonly grade: string
  readonly quantityKg: number
  readonly originSite: string
  readonly originRegion: string
  readonly seller: Seller
  readonly priceTzsPerKg: number
  readonly priceHintTzs: number
  readonly photos: readonly string[]
  readonly assayPdfUrl: string
  readonly assayResults: readonly AssayResult[]
  readonly chainOfCustody: readonly string[]
  readonly listedAt: string
  readonly status: 'open' | 'reserved' | 'closed'
}

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'countered'

export interface BidMessage {
  readonly id: string
  readonly from: 'buyer' | 'seller'
  readonly body: string
  readonly sentAt: string
}

export interface Bid {
  readonly id: string
  readonly listingId: string
  readonly listingTitle: string
  readonly mineral: Mineral
  readonly offerTzsPerKg: number
  readonly quantityKg: number
  readonly status: BidStatus
  readonly placedAt: string
  readonly thread: readonly BidMessage[]
}
