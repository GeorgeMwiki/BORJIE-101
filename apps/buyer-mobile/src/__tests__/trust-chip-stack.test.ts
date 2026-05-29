/**
 * TrustChipStack deriveTrustChips — pure-derivation tests.
 *
 * Pins the order and tone of the 5 trust chips so the
 * `buyer-marketplace-sota.md` §7 contract does not drift. The component
 * itself is RN-only — these tests cover the derivation logic which is
 * the load-bearing part.
 */

import { describe, expect, it } from 'vitest'
import { deriveTrustChips } from '../marketplace/trustChips'
import type { Listing } from '../types/listing'

function t(key: string): string {
  return key
}

const baseListing: Listing = {
  id: 'lst-1',
  mineral: 'gold_concentrate',
  title: 'Gold concentrate',
  grade: '22k',
  quantityKg: 5,
  originSite: 'Geita-North',
  originRegion: 'Geita',
  seller: {
    id: 's-1',
    name: 'Mahenge Mining',
    pmlNumber: 'PML-2026-0042',
    rating: 4.7,
    verified: true
  },
  priceTzsPerKg: 320_000_000,
  priceHintTzs: 1_600_000_000,
  photos: [],
  assayPdfUrl: 'https://example.com/assay.pdf',
  assayResults: [],
  chainOfCustody: ['cryptoseal:abc123', 'cryptoseal:def456'],
  listedAt: new Date().toISOString(),
  status: 'open'
}

const NOW = new Date('2026-05-29T10:00:00.000Z')

describe('deriveTrustChips — buyer-marketplace SOTA §7', () => {
  it('returns all 5 chips in stable order when every signal is present', () => {
    const chips = deriveTrustChips({ listing: baseListing, translate: t, now: NOW })
    expect(chips.map((c) => c.kind)).toEqual([
      'gov-licensed',
      'lab-assayed',
      'borjie-vetted',
      'chain-of-custody',
      'seller-history'
    ])
  })

  it('marks lab-assayed as verified when listed within 30 days', () => {
    const fresh = {
      ...baseListing,
      listedAt: new Date(NOW.getTime() - 7 * 24 * 3600 * 1000).toISOString()
    }
    const chips = deriveTrustChips({ listing: fresh, translate: t, now: NOW })
    const lab = chips.find((c) => c.kind === 'lab-assayed')
    expect(lab?.tone).toBe('verified')
  })

  it('marks lab-assayed as attention when listed > 30 days ago', () => {
    const stale = {
      ...baseListing,
      listedAt: new Date(NOW.getTime() - 60 * 24 * 3600 * 1000).toISOString()
    }
    const chips = deriveTrustChips({ listing: stale, translate: t, now: NOW })
    const lab = chips.find((c) => c.kind === 'lab-assayed')
    expect(lab?.tone).toBe('attention')
    expect(lab?.label).toContain('marketplace.trust.lab_assayed_stale')
  })

  it('drops borjie-vetted when seller.verified is false', () => {
    const unverified = { ...baseListing, seller: { ...baseListing.seller, verified: false } }
    const chips = deriveTrustChips({ listing: unverified, translate: t, now: NOW })
    expect(chips.find((c) => c.kind === 'borjie-vetted')).toBeUndefined()
  })

  it('drops gov-licensed when pmlNumber is empty', () => {
    const noLicense = { ...baseListing, seller: { ...baseListing.seller, pmlNumber: '' } }
    const chips = deriveTrustChips({ listing: noLicense, translate: t, now: NOW })
    expect(chips.find((c) => c.kind === 'gov-licensed')).toBeUndefined()
  })

  it('drops chain-of-custody chip when chainOfCustody is empty', () => {
    const noChain = { ...baseListing, chainOfCustody: [] }
    const chips = deriveTrustChips({ listing: noChain, translate: t, now: NOW })
    expect(chips.find((c) => c.kind === 'chain-of-custody')).toBeUndefined()
  })

  it('seller-history chip is attention when rating < 4.0', () => {
    const low = { ...baseListing, seller: { ...baseListing.seller, rating: 3.2 } }
    const chips = deriveTrustChips({ listing: low, translate: t, now: NOW })
    const history = chips.find((c) => c.kind === 'seller-history')
    expect(history?.tone).toBe('attention')
    expect(history?.label).toContain('3.2')
  })

  it('seller-history chip is verified when rating >= 4.0', () => {
    const high = { ...baseListing, seller: { ...baseListing.seller, rating: 4.5 } }
    const chips = deriveTrustChips({ listing: high, translate: t, now: NOW })
    const history = chips.find((c) => c.kind === 'seller-history')
    expect(history?.tone).toBe('verified')
  })

  it('every chip carries an evidence handle where the source supports it', () => {
    const chips = deriveTrustChips({ listing: baseListing, translate: t, now: NOW })
    expect(chips.find((c) => c.kind === 'gov-licensed')?.evidenceHandle).toBe('PML-2026-0042')
    expect(chips.find((c) => c.kind === 'lab-assayed')?.evidenceHandle).toBe(
      'https://example.com/assay.pdf'
    )
    expect(chips.find((c) => c.kind === 'chain-of-custody')?.evidenceHandle).toBe(
      'cryptoseal:abc123'
    )
  })

  it('returns empty array when no signals are present (no misleading "no trust" chips)', () => {
    const bare: Listing = {
      ...baseListing,
      seller: { ...baseListing.seller, pmlNumber: '', verified: false, rating: 0 },
      assayPdfUrl: '',
      chainOfCustody: []
    }
    const chips = deriveTrustChips({ listing: bare, translate: t, now: NOW })
    expect(chips).toEqual([])
  })
})
