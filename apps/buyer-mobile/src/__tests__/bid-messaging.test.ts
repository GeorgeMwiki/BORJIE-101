import { describe, expect, it } from 'vitest'

import {
  normalizeThreadMessages,
  newIdempotencyKey,
  formatReputation,
  type ThreadMessageWire,
  type SellerReputation,
} from '../marketplace/threadMessages'

// NOTE: we import the PURE helpers directly (not `@/api/bid-messaging`,
// which pulls `@/api/client` → expo-secure-store and trips the vitest
// rollup parser — same constraint as src/__tests__/rfb.test.ts).

describe('WS-2 — normalizeThreadMessages', () => {
  it('maps senderRole → from and sorts oldest-first', () => {
    const wire: ThreadMessageWire[] = [
      { id: 'b', senderRole: 'seller', body: 'second', createdAt: '2026-06-01T10:05:00Z' },
      { id: 'a', senderRole: 'buyer', body: 'first', createdAt: '2026-06-01T10:00:00Z' },
    ]
    const out = normalizeThreadMessages(wire)
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
    expect(out[0]?.from).toBe('buyer')
    expect(out[1]?.from).toBe('seller')
    expect(out[0]?.body).toBe('first')
  })

  it('returns an empty array for an empty thread', () => {
    expect(normalizeThreadMessages([])).toEqual([])
  })
})

describe('WS-2 — newIdempotencyKey', () => {
  it('produces a prefixed, reasonably-unique key each call', () => {
    const a = newIdempotencyKey('msg')
    const b = newIdempotencyKey('msg')
    expect(a.startsWith('msg-')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('WS-2 — formatReputation', () => {
  it('renders stars + count when rated', () => {
    const rep: SellerReputation = {
      sellerTenantId: 't-seller',
      ratingCount: 7,
      averageStars: 4.43,
    }
    expect(formatReputation(rep, 'No ratings yet')).toBe('4.4 ★ (7)')
  })

  it('shows the no-ratings label for an unrated seller', () => {
    const rep: SellerReputation = {
      sellerTenantId: 't-seller',
      ratingCount: 0,
      averageStars: null,
    }
    expect(formatReputation(rep, 'No ratings yet')).toBe('No ratings yet')
    expect(formatReputation(rep, 'Bado hakuna ukadiriaji')).toBe(
      'Bado hakuna ukadiriaji',
    )
  })
})
