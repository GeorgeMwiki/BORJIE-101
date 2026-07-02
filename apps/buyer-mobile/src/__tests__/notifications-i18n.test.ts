import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import sw from '../i18n/sw.json'
import { translate } from '../i18n'

// Regression guard for the round-2 zero-mix leftover in
// apps/buyer-mobile/app/notifications.tsx: the screen previously hardcoded
// its inbox copy via inline `isSw ? 'Arifa' : 'Notifications'` ternaries,
// bypassing the i18n layer. A missing key in either locale would surface as
// the raw path in the UI, and a key present in only one locale risks EN/SW
// mixing (ABSOLUTE-forbidden). So we assert both bundles carry every key and
// that `translate` returns real copy (not the raw path) in each locale.

describe('notifications i18n — inbox copy (locale parity)', () => {
  const keys = [
    'title',
    'subtitle',
    'loading',
    'error',
    'empty',
    'unread_title',
    'mark_all_read',
  ] as const

  it('English bundle carries every notifications key', () => {
    const ns = en.notifications as Record<string, unknown>
    for (const key of keys) {
      expect(typeof ns[key]).toBe('string')
      expect((ns[key] as string).length).toBeGreaterThan(0)
    }
  })

  it('Swahili bundle carries every notifications key (no gaps → no EN/SW mixing)', () => {
    const ns = sw.notifications as Record<string, unknown>
    for (const key of keys) {
      expect(typeof ns[key]).toBe('string')
      expect((ns[key] as string).length).toBeGreaterThan(0)
    }
  })

  it('translate resolves keys per-locale without leaking the raw path', () => {
    for (const key of keys) {
      const path = `notifications.${key}`
      expect(translate('en', path)).not.toBe(path)
      expect(translate('sw', path)).not.toBe(path)
    }
  })

  it('unread_title interpolates the count in each locale', () => {
    expect(translate('en', 'notifications.unread_title', { count: 3 })).toContain('3')
    expect(translate('sw', 'notifications.unread_title', { count: 3 })).toContain('3')
    // Single-locale per surface: EN copy must not carry the SW word and vice
    // versa (a smoke check that the two locales are genuinely distinct here).
    expect(translate('en', 'notifications.title')).toBe('Notifications')
    expect(translate('sw', 'notifications.title')).toBe('Arifa')
  })
})
