import { describe, it, expect } from 'vitest'
import { bcp47For, formatDateTime, formatInteger } from '../i18n/locale-format'
import type { Lang } from '../auth/types'

/**
 * The shared active-locale formatters (src/i18n/locale-format.ts) exist so no
 * screen renders a hardcoded BCP-47 tag (locale-follows-the-user canon). These
 * assert the resolver maps each locale correctly, falls back to English for an
 * unexpected value (never to the host device locale), and degrades non-finite /
 * non-parseable inputs to an em-dash instead of "Invalid Date" / "NaN".
 */
describe('bcp47For', () => {
  it('maps sw -> sw-TZ and en -> en-GB', () => {
    expect(bcp47For('sw')).toBe('sw-TZ')
    expect(bcp47For('en')).toBe('en-GB')
  })
  it('falls back to English for an unexpected locale (structural default)', () => {
    expect(bcp47For('xx' as unknown as Lang)).toBe('en-GB')
  })
})

describe('formatInteger', () => {
  it('groups a finite integer in the active locale', () => {
    // Both sw-TZ and en-GB group thousands with a comma; assert grouping, not tag.
    expect(formatInteger(1234567, 'en')).toBe('1,234,567')
    expect(formatInteger(1234567, 'sw')).toBe('1,234,567')
  })
  it('degrades a non-finite value to an em-dash', () => {
    expect(formatInteger(Number.NaN, 'en')).toBe('—')
    expect(formatInteger(Number.POSITIVE_INFINITY, 'sw')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('renders a parseable ISO string for the active locale', () => {
    const out = formatDateTime('2026-07-03T09:30:00.000Z', 'en')
    expect(out).not.toBe('—')
    expect(out.length).toBeGreaterThan(0)
  })
  it('degrades a non-parseable ISO string to an em-dash', () => {
    expect(formatDateTime('not-a-date', 'en')).toBe('—')
    expect(formatDateTime('', 'sw')).toBe('—')
  })
})
