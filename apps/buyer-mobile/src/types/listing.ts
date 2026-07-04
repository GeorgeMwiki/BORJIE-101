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
  // `null` = no quantity attribute on the listing (a legitimate state — quantity
  // lives in the free-form attributes JSON and may be absent). NEVER a 0 sentinel
  // (which renders "0 g" as a fabricated parcel weight); the render shows "— kg".
  readonly quantityKg: number | null
  readonly originSite: string
  readonly originRegion: string
  readonly seller: Seller
  // `null` = no price hint (a legitimate solicit-bids listing — marketplace
  // priceTzs is nullable). NEVER coerce an absent price to 0; the render layer
  // shows an honest placeholder for null.
  readonly priceTzsPerKg: number | null
  readonly priceHintTzs: number | null
  readonly photos: readonly string[]
  readonly assayPdfUrl: string
  readonly assayResults: readonly AssayResult[]
  readonly chainOfCustody: readonly string[]
  readonly listedAt: string
  readonly status: 'open' | 'reserved' | 'closed'
  /**
   * Owning-mine attribution joined by the gateway from `tenants`
   * (`marketplace_listings.tenant_id`). Drives the "from <mine>" label
   * and the owner-scoped ("buy from this mine") browse. Optional because
   * older fixtures / chat-card payloads carry only the rich `seller`.
   */
  readonly sellerTenantId?: string
  readonly sellerName?: string | null
}

/**
 * A seller org that has at least one buyer-visible active listing —
 * the row a "browse by mine" surface lists. Mirrors the gateway
 * `GET /mining/marketplace/listings/sellers` response shape.
 */
export interface MarketplaceSeller {
  readonly sellerTenantId: string
  readonly sellerName: string | null
  readonly listingCount: number
}

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'withdrawn'

export interface BidMessage {
  readonly id: string
  readonly from: 'buyer' | 'seller'
  readonly body: string
  readonly sentAt: string
}

/**
 * Chat-as-OS bidirectional parity envelope. Stamped on every bid /
 * inquiry / kyc row at insert time by the gateway. Optional for
 * backwards compatibility with older fixtures.
 */
export interface ProvenanceEnvelope {
  readonly via: 'chat' | 'form' | 'agent_apply' | 'api' | 'legacy' | 'unknown'
  readonly actorId?: string | null
  readonly sessionId?: string | null
  readonly turnId?: string | null
  readonly requestedAt?: string
}

export interface Bid {
  readonly id: string
  readonly listingId: string
  readonly listingTitle: string
  readonly mineral: Mineral
  // `null` = the bid persists only its TOTAL bidPriceTzs and the listing carries
  // NO quantity attribute, so a per-kg figure cannot be reconstructed. NEVER the
  // TOTAL mislabeled as per-kg (a fabricated "TZS 50M / kg"); the render shows
  // "TZS —". Reconstructed (total ÷ quantity) only when a real quantity exists.
  readonly offerTzsPerKg: number | null
  // `null` = the listing carries NO quantity attribute, so the parcel weight is
  // unknown. NEVER a fabricated `1` (which renders "1 kg" as fact); the render
  // shows "— kg".
  readonly quantityKg: number | null
  // The REAL persisted total the buyer offered (gateway `bidPriceTzs`), always
  // present. Use THIS for the total — never `offerTzsPerKg * quantityKg`, which
  // is null (unknown) when the listing carries no quantity.
  readonly bidTotalTzs: number
  readonly status: BidStatus
  readonly placedAt: string
  readonly thread: readonly BidMessage[]
  /**
   * RFB-response thread key for the WS-2 bid chat. Present when this bid
   * has a live buyer↔seller thread (loaded via api/bid-messaging.ts
   * fetchThread/sendThreadMessage). Null for marketplace bids that carry
   * no chat thread.
   */
  readonly threadResponseId?: string | null
  /**
   * Chat-as-OS bidirectional parity. When `via === 'chat'` the buyer
   * sees a small "via Mr. Mwikila" pill next to the bid in the My
   * Bids list; tapping it opens the chat session at the originating
   * turn.
   */
  readonly provenance?: ProvenanceEnvelope
}
