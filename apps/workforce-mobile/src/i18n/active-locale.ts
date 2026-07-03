import type { Lang } from '../auth/types'

/**
 * A tiny module-level cache of the ACTIVE app locale, written by `useI18n`
 * whenever it resolves the locale and read by surfaces that CANNOT use the
 * `useI18n` hook — chiefly `PilotErrorBoundary`, a class component mounted at
 * the tree root (above the auth/i18n provider) whose synchronous `render()`
 * has no access to hooks or async storage.
 *
 * WHY THIS EXISTS
 * ───────────────
 * An error boundary that hardcodes a single language paints that language to
 * every user on any crash — a zero-mix violation (CLAUDE.md "English default ·
 * bilingual sw/en"; the toggle is ABSOLUTE). It cannot call `useI18n`, and the
 * persisted locale lives behind async storage. This cache lets the boundary
 * render the LAST-RESOLVED active locale synchronously. It defaults to `en`
 * (the app default) so the very first paint — before `useI18n` has ever run —
 * is the correct default language, never Swahili.
 */
let activeLocale: Lang = 'en'

export function setActiveLocale(lang: Lang): void {
  activeLocale = lang
}

export function getActiveLocale(): Lang {
  return activeLocale
}
