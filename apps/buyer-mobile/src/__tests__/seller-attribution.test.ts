import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import sw from '../i18n/sw.json'
import { resolveSellerName } from '../marketplace/sellerAttribution'
import type { Listing, Seller } from '../types/listing'

// NOTE: we import the PURE helper directly (not `@/api/marketplace`, which
// pulls `@/api/client` → expo-secure-store and trips the vitest rollup
// parser — same constraint as src/__tests__/rfb.test.ts).

const baseSeller: Seller = {
  id: 'S1',
  name: 'Mwana Mining',
  pmlNumber: 'PML-001',
  rating: 4.6,
  verified: true
}

function listing(over: Partial<Listing>): Pick<Listing, 'sellerName' | 'seller'> {
  return { seller: baseSeller, ...over }
}

describe('resolveSellerName — owning-mine attribution', () => {
  it('prefers the gateway sellerName (joined from tenants)', () => {
    expect(
      resolveSellerName(listing({ sellerName: 'Geita Gold Co' }), 'This mine')
    ).toBe('Geita Gold Co')
  })

  it('falls back to the rich seller.name when sellerName is absent/empty', () => {
    expect(resolveSellerName(listing({ sellerName: null }), 'This mine')).toBe(
      'Mwana Mining'
    )
    expect(resolveSellerName(listing({ sellerName: '' }), 'This mine')).toBe(
      'Mwana Mining'
    )
  })

  it('falls back to the placeholder when neither is present (never empty label)', () => {
    const orphan = { sellerName: null, seller: { ...baseSeller, name: '' } }
    expect(resolveSellerName(orphan, 'This mine')).toBe('This mine')
  })
})

describe('marketplace i18n — owner-scoped keys (locale parity)', () => {
  const required = [
    'from_seller',
    'browse_by_mine',
    'listings_count_unit',
    'this_mine',
    'from_mine_subtitle',
    'mine_empty'
  ] as const

  it('English bundle carries every owner-scoped marketplace key', () => {
    const block = en.marketplace as Record<string, unknown>
    for (const key of required) {
      expect(typeof block[key]).toBe('string')
      expect((block[key] as string).length).toBeGreaterThan(0)
    }
  })

  it('Swahili bundle carries every owner-scoped marketplace key (no gaps → no EN/SW mixing)', () => {
    const block = sw.marketplace as Record<string, unknown>
    for (const key of required) {
      expect(typeof block[key]).toBe('string')
      expect((block[key] as string).length).toBeGreaterThan(0)
    }
  })
})
