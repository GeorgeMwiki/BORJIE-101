import type { ListingFilters } from './marketplace'

export const queryKeys = {
  listings: (filters: ListingFilters) => ['listings', filters] as const,
  listing: (id: string) => ['listing', id] as const,
  // Browse-by-mine — distinct seller orgs with buyer-visible listings.
  marketplaceSellers: () => ['marketplace-sellers'] as const,
  bids: () => ['bids'] as const,
  bid: (id: string) => ['bid', id] as const,
  // Offtake completion-law — the buyer's binding offtake contracts (the
  // complementary leg materialized when a seller accepts a bid).
  offtakeAgreements: () => ['offtake-agreements', 'mine'] as const,
  offtakeForBid: (bidId: string) => ['offtake-for-bid', bidId] as const,
  documents: () => ['documents'] as const,
  document: (id: string) => ['document', id] as const,
  kycStatus: (id: string) => ['kyc-status', id] as const,
  // Buyer wallet snapshot (balances + display-only FX).
  wallet: () => ['wallet'] as const,
  // R11 — buyer-initiated RFB.
  rfbsMine: () => ['rfbs', 'mine'] as const,
  rfbResponses: (rfbId: string) => ['rfb-responses', rfbId] as const,
  // Commercial chain L7 — buyer notifications.
  buyerNotifications: (unreadOnly: boolean) =>
    ['buyer-notifications', unreadOnly ? 'unread' : 'all'] as const,
  // WS-2 — bid chat thread per RFB response + seller reputation.
  thread: (responseId: string) => ['thread', responseId] as const,
  sellerReputation: (sellerTenantId: string) =>
    ['seller-reputation', sellerTenantId] as const,
  marketIntel: (commodity: string, region: string | undefined) =>
    ['market-intel', commodity, region ?? 'all'] as const,
} as const
