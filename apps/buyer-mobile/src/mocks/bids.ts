import type { Bid } from '@/types/listing'

export const mockBids: readonly Bid[] = [
  {
    id: 'bid-001',
    listingId: 'lst-001',
    listingTitle: 'Gold concentrate · Geita Greenstone',
    mineral: 'gold_concentrate',
    offerTzsPerKg: 31_800_000,
    quantityKg: 18,
    status: 'pending',
    placedAt: '2026-05-22T09:00:00Z',
    thread: [
      {
        id: 'msg-001',
        from: 'buyer',
        body: 'Tunaweza kuchukua kifurushi chote kwa TZS 31.8M/kg. Malipo ndani ya siku 3.',
        sentAt: '2026-05-22T09:00:00Z'
      }
    ]
  },
  {
    id: 'bid-002',
    listingId: 'lst-004',
    listingTitle: 'Copper concentrate · Mbeya',
    mineral: 'copper_concentrate',
    offerTzsPerKg: 21_900,
    quantityKg: 28_000,
    status: 'countered',
    placedAt: '2026-05-20T13:00:00Z',
    thread: [
      {
        id: 'msg-002',
        from: 'buyer',
        body: 'Offer TZS 21,900/kg for full parcel, FOR Mbeya railhead.',
        sentAt: '2026-05-20T13:00:00Z'
      },
      {
        id: 'msg-003',
        from: 'seller',
        body: 'Counter: TZS 22,400/kg, payment 50% on signing, 50% on rail receipt.',
        sentAt: '2026-05-21T08:15:00Z'
      }
    ]
  },
  {
    id: 'bid-003',
    listingId: 'lst-006',
    listingTitle: 'Gold doré bars · Chunya',
    mineral: 'gold_dore',
    offerTzsPerKg: 264_000_000,
    quantityKg: 6.4,
    status: 'accepted',
    placedAt: '2026-05-22T11:00:00Z',
    thread: [
      {
        id: 'msg-004',
        from: 'buyer',
        body: 'Offer TZS 264M/kg, contract draft attached.',
        sentAt: '2026-05-22T11:00:00Z'
      },
      {
        id: 'msg-005',
        from: 'seller',
        body: 'Accepted. Please proceed with signature.',
        sentAt: '2026-05-23T07:30:00Z'
      }
    ]
  }
] as const

export function findBid(id: string): Bid | undefined {
  return mockBids.find((bid) => bid.id === id)
}
