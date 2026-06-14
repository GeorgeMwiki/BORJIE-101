import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import sw from '../i18n/sw.json'

// NOTE: we import the i18n JSON bundles directly (not `@/api/marketplace`,
// which pulls `@/api/client` → expo-secure-store and trips the vitest
// rollup parser — same constraint as src/__tests__/seller-attribution.test.ts).
//
// Regression guard for the Mode-C bid findings:
//   - a `withdrawn` bid must render its own honest label (was coerced to
//     "pending" because the key was missing);
//   - the bid-price field must show a real validation message (was wrongly
//     showing `common.retry`).
// A missing key in either locale would surface as the raw key string in the
// UI — and a key present in only one locale risks EN/SW mixing, which is
// ABSOLUTE-forbidden. So we assert both locales carry every key.

describe('bids i18n — status + validation keys (locale parity)', () => {
  const statusKeys = ['pending', 'accepted', 'rejected', 'countered', 'withdrawn'] as const
  const bidKeys = ['bid_price_invalid'] as const

  it('English bundle carries every bid status + validation key', () => {
    const status = (en.bids as { status: Record<string, unknown> }).status
    for (const key of statusKeys) {
      expect(typeof status[key]).toBe('string')
      expect((status[key] as string).length).toBeGreaterThan(0)
    }
    const bids = en.bids as Record<string, unknown>
    for (const key of bidKeys) {
      expect(typeof bids[key]).toBe('string')
      expect((bids[key] as string).length).toBeGreaterThan(0)
    }
  })

  it('Swahili bundle carries every bid status + validation key (no gaps → no EN/SW mixing)', () => {
    const status = (sw.bids as { status: Record<string, unknown> }).status
    for (const key of statusKeys) {
      expect(typeof status[key]).toBe('string')
      expect((status[key] as string).length).toBeGreaterThan(0)
    }
    const bids = sw.bids as Record<string, unknown>
    for (const key of bidKeys) {
      expect(typeof bids[key]).toBe('string')
      expect((bids[key] as string).length).toBeGreaterThan(0)
    }
  })
})
