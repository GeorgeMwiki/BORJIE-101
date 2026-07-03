import { describe, expect, it } from 'vitest'
// Import from the pure adapter module (not `./marketplace`, which pulls in
// the react-native API client) so the test runs under the node/rollup rig.
import { mapListing } from './listing-adapter'

// The adapter under test hardens ONE raw `marketplace_listings` gateway row
// (see services/api-gateway/src/routes/mining/marketplace.hono.ts — the row
// is spread verbatim with numeric columns string-encoded and the rich
// domain fields buried in `attributes`) into the FE `Listing` shape every
// buyer screen reads directly. These tests pin the four defect fixes:
// status mapping, guarded arrays (never `undefined`), price parse, and
// no-fabricated-reputation.

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    title: 'Gold parcel — lot 1',
    category: 'mineral',
    priceTzs: '120000000.00',
    priceUnit: 'kg',
    status: 'active',
    visibility: 'tanzania',
    photos: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
    attributes: {
      mineral: 'gold_concentrate',
      grade: '96.5%',
      quantityKg: 12,
      region: 'Geita',
      originSite: 'Nyakabale Pit 3',
      assayPdfUrl: 'https://cdn.example/assay.pdf',
      assayResults: [{ element: 'Au', grade: '96.5%', method: 'fire_assay' }],
      chainOfCustody: ['Extracted', 'Assayed', 'Sealed']
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    sellerTenantId: 'tenant-seller',
    sellerName: 'Nyakabale Mine',
    ...overrides
  }
}

describe('mapListing', () => {
  it('maps a full raw row into the FE Listing shape', () => {
    const listing = mapListing(rawRow())
    expect(listing.id).toBe('listing-1')
    expect(listing.title).toBe('Gold parcel — lot 1')
    expect(listing.mineral).toBe('gold_concentrate')
    expect(listing.grade).toBe('96.5%')
    expect(listing.quantityKg).toBe(12)
    expect(listing.originSite).toBe('Nyakabale Pit 3')
    expect(listing.originRegion).toBe('Geita')
    expect(listing.photos).toEqual([
      'https://cdn.example/a.jpg',
      'https://cdn.example/b.jpg'
    ])
    expect(listing.listedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(listing.sellerTenantId).toBe('tenant-seller')
    expect(listing.sellerName).toBe('Nyakabale Mine')
  })

  it('parses the total price hint and derives per-kg from quantity', () => {
    const listing = mapListing(rawRow())
    // priceTzs is the STRING-encoded total; per-kg = total ÷ quantityKg.
    expect(listing.priceHintTzs).toBe(120_000_000)
    expect(listing.priceTzsPerKg).toBe(10_000_000)
  })

  it('keeps quantity NULL when absent (never a fabricated 0) + per-kg falls back to the total', () => {
    const listing = mapListing(
      rawRow({ attributes: { mineral: 'coltan', grade: 'A', region: 'Kagera' } })
    )
    // Absent quantity → null (renders "— kg"), never 0 (which renders "0 g").
    expect(listing.quantityKg).toBeNull()
    expect(listing.priceHintTzs).toBe(120_000_000)
    expect(listing.priceTzsPerKg).toBe(120_000_000)
  })

  it('keeps an ABSENT price as null (never a fabricated 0) for a solicit-bids listing', () => {
    // marketplace priceTzs is nullable — a legitimate no-price listing.
    const nullPrice = mapListing(rawRow({ priceTzs: null }))
    expect(nullPrice.priceHintTzs).toBeNull()
    expect(nullPrice.priceTzsPerKg).toBeNull()
    // undefined + empty-string encodings degrade the same way (Number('')===0).
    expect(mapListing(rawRow({ priceTzs: undefined })).priceHintTzs).toBeNull()
    expect(mapListing(rawRow({ priceTzs: '' })).priceHintTzs).toBeNull()
  })

  it('maps DB status → FE enum (active→open, sold→closed, paused→reserved)', () => {
    expect(mapListing(rawRow({ status: 'active' })).status).toBe('open')
    expect(mapListing(rawRow({ status: 'sold' })).status).toBe('closed')
    expect(mapListing(rawRow({ status: 'removed' })).status).toBe('closed')
    expect(mapListing(rawRow({ status: 'paused' })).status).toBe('reserved')
    expect(mapListing(rawRow({ status: 'expired' })).status).toBe('reserved')
    // Unrecognised / missing status never masquerades as biddable.
    expect(mapListing(rawRow({ status: 'weird' })).status).toBe('closed')
    expect(mapListing(rawRow({ status: undefined })).status).toBe('closed')
  })

  it('guards every array to [] when attributes are missing (no crash surface)', () => {
    const listing = mapListing({ id: 'bare', title: 'Bare', priceTzs: null })
    expect(listing.chainOfCustody).toEqual([])
    expect(listing.assayResults).toEqual([])
    expect(listing.photos).toEqual([])
    // Arrays are the exact fields the detail screen `.map`s over — these
    // being [] (never undefined) is the crash fix.
    expect(Array.isArray(listing.chainOfCustody)).toBe(true)
    expect(Array.isArray(listing.assayResults)).toBe(true)
  })

  it('never fabricates seller reputation but carries attribution', () => {
    const listing = mapListing(rawRow())
    expect(listing.seller.name).toBe('Nyakabale Mine')
    expect(listing.seller.id).toBe('tenant-seller')
    // The gateway serves no rating column — we must not invent one.
    expect(listing.seller.rating).toBe(0)
    expect(listing.seller.verified).toBe(false)
  })

  it('parses a numeric price when the row is not string-encoded', () => {
    const listing = mapListing(rawRow({ priceTzs: 500 }))
    expect(listing.priceHintTzs).toBe(500)
  })

  it('normalises terse back-office mineral codes into the FE enum', () => {
    expect(mapListing(rawRow({ attributes: { mineral: 'Au' } })).mineral).toBe(
      'gold_concentrate'
    )
    expect(
      mapListing(rawRow({ attributes: { mineral: 'Au+Cu' } })).mineral
    ).toBe('gold_concentrate')
    expect(
      mapListing(rawRow({ attributes: { mineral: 'Diamond+Tanzanite' } })).mineral
    ).toBe('gemstone_mixed')
    // Unknown mineral defaults so mineralGlyph[...] never indexes undefined.
    expect(
      mapListing(rawRow({ attributes: { mineral: 'unobtanium' } })).mineral
    ).toBe('gold_concentrate')
  })

  it('reads quantity from the snake_case attribute variant too', () => {
    const listing = mapListing(
      rawRow({ attributes: { mineral: 'Au', quantity_kg: 8 }, priceTzs: '80' })
    )
    expect(listing.quantityKg).toBe(8)
    expect(listing.priceTzsPerKg).toBe(10)
  })
})
