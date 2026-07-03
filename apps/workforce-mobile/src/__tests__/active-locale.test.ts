import { describe, it, expect, afterEach } from 'vitest'
import { getActiveLocale, setActiveLocale } from '../i18n/active-locale'

/**
 * The active-locale module cache lets hook-less surfaces (PilotErrorBoundary, a
 * root class component above the i18n provider) render the last-resolved locale
 * synchronously on a crash instead of a hardcoded language. It MUST default to
 * `en` (the app default) so the first paint — before useI18n has ever run — is
 * never Swahili.
 */
describe('active-locale cache', () => {
  afterEach(() => {
    // Restore the default so cross-test order can't leak a stale locale.
    setActiveLocale('en')
  })

  it('defaults to en (the app default, never Swahili)', () => {
    expect(getActiveLocale()).toBe('en')
  })

  it('reflects the last locale set', () => {
    setActiveLocale('sw')
    expect(getActiveLocale()).toBe('sw')
    setActiveLocale('en')
    expect(getActiveLocale()).toBe('en')
  })
})
