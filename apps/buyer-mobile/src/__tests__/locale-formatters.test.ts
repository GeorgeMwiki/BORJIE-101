/**
 * Zero-mix locale-formatter tests. Every date/number formatter on the
 * bilingual buyer surface must thread the ACTIVE app locale through the
 * single `bcp47For` resolver — never a hardcoded `en-GB`/`en-US`/`sw-TZ`
 * literal and never the host device locale. These tests pin the resolver
 * mapping and prove the formatters honour the caller's locale.
 */
import { describe, expect, it } from 'vitest'
import { bcp47For } from '../lib/locale'
import { formatDate } from '../components/formatters'
import { formatKm } from '../marketplace/distance'

describe('bcp47For — active-locale BCP-47 resolver', () => {
  it('maps en to en-GB', () => {
    expect(bcp47For('en')).toBe('en-GB')
  })

  it('maps sw to sw-TZ', () => {
    expect(bcp47For('sw')).toBe('sw-TZ')
  })

  it('defaults an unexpected value to the English tag (structural default)', () => {
    // Cast simulates a runtime value outside the union — English is the
    // structural fallback, NEVER the host device locale.
    expect(bcp47For('xx' as 'en')).toBe('en-GB')
  })
})

describe('formatDate — locale-aware, no host-default fall-through', () => {
  it('renders the same instant differently per active locale', () => {
    const iso = '2026-03-27T00:00:00.000Z'
    const en = formatDate(iso, 'en')
    const sw = formatDate(iso, 'sw')
    // Both are real, non-empty renders (not the em-dash degrade).
    expect(en).not.toBe('—')
    expect(sw).not.toBe('—')
    // The English render uses the English month abbreviation.
    expect(en).toMatch(/Mar/)
    // The Swahili render must NOT leak the English abbreviation — proving
    // the active locale drove the format rather than a hardcoded tag.
    expect(sw).not.toMatch(/Mar/)
  })

  it('degrades a non-parseable ISO string to an em-dash', () => {
    expect(formatDate('not-a-date', 'en')).toBe('—')
    expect(formatDate('', 'sw')).toBe('—')
  })
})

describe('formatKm — locale-aware grouping', () => {
  it('formats through the active-locale grouping and keeps the km suffix', () => {
    expect(formatKm(1085, 'en')).toMatch(/km$/)
    expect(formatKm(1085, 'sw')).toMatch(/km$/)
  })
})
