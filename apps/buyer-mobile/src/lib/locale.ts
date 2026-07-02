import type { LanguageCode } from '@/types/auth'

/**
 * Resolve the Intl BCP-47 tag from the active buyer-app locale — the
 * locale-follows-the-user canon (CLAUDE.md "English default · bilingual
 * sw/en"). NEVER hardcode `'en-US'`/`'en-GB'` at a formatter site and NEVER
 * let a bare `.toLocaleString()` / `.toLocaleDateString()` fall through to
 * the host device locale, which would render one screen in a language the
 * buyer never chose (a zero-mix violation). This is the single resolver every
 * `Intl.*` / `toLocale*` call in buyer-mobile threads the active locale
 * through, mirroring the workforce-mobile owner `bcp47For` pattern.
 */
const BCP47_BY_LANG: Readonly<Record<LanguageCode, string>> = {
  sw: 'sw-TZ',
  en: 'en-GB',
}

export function bcp47For(lang: LanguageCode): string {
  // Map lookup (not a locale ternary): these are Intl BCP-47 TAGS, not
  // user-facing copy, and English is the structural default for any
  // unexpected value.
  return BCP47_BY_LANG[lang] ?? BCP47_BY_LANG.en
}
