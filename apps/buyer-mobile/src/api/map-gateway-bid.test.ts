/**
 * Regression test — A2 finding: mapGatewayBid fabricated a per-kg price and a
 * phantom 1 kg parcel when the listing carried NO quantity attribute. A bid
 * persists only its TOTAL bidPriceTzs; per-kg + quantity are reconstructed from
 * `attributes.quantityKg`. When that attribute is absent (a legit gateway
 * state), the old mapper set offerTzsPerKg = TOTAL (mislabeled as per-kg) and
 * quantityKg = 1, rendering "TZS 50.00M / kg" and "1 kg" as facts.
 *
 * These tests pin the honest behaviour: no quantity ⇒ BOTH per-kg and quantity
 * are null (render shows "TZS —" / "— kg"), while the real TOTAL survives; a
 * real quantity still reconstructs the per-kg price by division.
 */

import { describe, it, expect } from 'vitest'
// Import from the pure adapter module (not `./marketplace`, which pulls in
// the react-native API client) so the test runs under the node/rollup rig —
// the same split `listing-adapter.test.ts` uses.
import { mapGatewayBid } from './bid-adapter'

const baseRow = {
  id: 'bid_1',
  listingId: 'lst_1',
  bidPriceTzs: '50000000',
  status: 'pending',
  createdAt: '2026-07-04T00:00:00.000Z',
} as const

describe('mapGatewayBid', () => {
  it('never fabricates per-kg + quantity when the listing has no quantity', () => {
    const bid = mapGatewayBid(baseRow, {
      id: 'lst_1',
      title: 'Gold concentrate parcel',
      category: 'gold_concentrate',
      priceTzs: null,
      // No `quantityKg` attribute — a legitimate gateway state.
      attributes: { mineral: 'gold_concentrate' },
    })
    expect(bid.offerTzsPerKg).toBeNull()
    expect(bid.quantityKg).toBeNull()
  })

  it('treats a zero / non-positive quantity attribute as absent (null, never 1 kg)', () => {
    const bid = mapGatewayBid(baseRow, {
      id: 'lst_1',
      title: 'Gold concentrate parcel',
      category: 'gold_concentrate',
      priceTzs: null,
      attributes: { mineral: 'gold_concentrate', quantityKg: 0 },
    })
    expect(bid.offerTzsPerKg).toBeNull()
    expect(bid.quantityKg).toBeNull()
  })

  it('nulls per-kg + quantity even with no listing join at all', () => {
    const bid = mapGatewayBid(baseRow)
    expect(bid.offerTzsPerKg).toBeNull()
    expect(bid.quantityKg).toBeNull()
  })

  it('reconstructs a real per-kg price when the listing carries a quantity', () => {
    const bid = mapGatewayBid(baseRow, {
      id: 'lst_1',
      title: 'Gold concentrate parcel',
      category: 'gold_concentrate',
      priceTzs: null,
      attributes: { mineral: 'gold_concentrate', quantityKg: 100 },
    })
    expect(bid.quantityKg).toBe(100)
    expect(bid.offerTzsPerKg).toBe(500000)
  })
})
