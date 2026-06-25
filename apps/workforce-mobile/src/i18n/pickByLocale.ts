/**
 * pickByLocale — select a SINGLE-LOCALE string from a `{ en, sw }` pair using
 * the active locale, with a visible-placeholder (never cross-language) miss.
 *
 * The canon (CLAUDE.md · language-engineering rule 3): a missing locale value
 * must NEVER fall back to the other language (that IS mixing). When the active
 * locale's value is absent or empty we return a neutral visible placeholder
 * (`'—'`) so a parity gap is loud and never silently renders the other tongue —
 * the exact opposite of the forbidden `titleSw || titleEn` cross-language
 * fallback.
 *
 * Pure (no React/RN), so the node vitest harness can exercise it cold.
 */
import type { Lang } from '../auth/types'

export interface LocalePair {
  readonly en: string
  readonly sw: string
}

/** Visible placeholder shown when the active-locale value is missing/empty. */
export const MISSING_PLACEHOLDER = '—'

/**
 * Return the active-locale string from a `{ en, sw }` pair. A missing/empty
 * value yields the visible placeholder — NEVER the other locale's string.
 */
export function pickByLocale(pair: LocalePair, lang: Lang): string {
  const value = pair[lang]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  return MISSING_PLACEHOLDER
}
