import type { Lang } from '../auth/types'

/**
 * App-wide locale-aware formatters, resolved from the ACTIVE app locale — the
 * locale-follows-the-user canon (CLAUDE.md "English default · bilingual sw/en";
 * rule 5: NEVER hardcode a BCP-47 tag in logic). A bare
 * `.toLocaleString('sw-TZ')` / `.toLocaleString('en-US')` renders one surface in
 * a language the user never chose (a zero-mix violation) or falls through to the
 * host device locale. Every screen — worker OR owner — routes date/number
 * rendering through here so there is ONE resolver, not a per-screen literal.
 *
 * Mirrors the owner-home `src/home/owner/format.ts` single-resolver pattern;
 * this is the shared, screen-agnostic home for it.
 */
const BCP47_BY_LANG: Readonly<Record<Lang, string>> = {
  sw: 'sw-TZ',
  en: 'en-GB'
}

/**
 * Resolve the Intl BCP-47 tag from the active app locale. Map lookup (not a
 * locale ternary): these are Intl TAGS, not user-facing copy, and English is
 * the structural default for any unexpected value.
 */
export function bcp47For(lang: Lang): string {
  return BCP47_BY_LANG[lang] ?? BCP47_BY_LANG.en
}

/**
 * Locale-aware date+time render for the active app locale. Replaces bare
 * `new Date(iso).toLocaleString('sw-TZ')` calls that render Swahili month/format
 * to an EN user (or fall through to the host locale). A non-parseable ISO string
 * degrades to an em-dash rather than painting `Invalid Date`.
 */
export function formatDateTime(iso: string, lang: Lang): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) {
    return '—'
  }
  return new Intl.DateTimeFormat(bcp47For(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts))
}

/**
 * Locale-aware integer render for the active app locale. Replaces bare
 * `n.toLocaleString('en-US')` calls that hardcode a locale's digit grouping.
 * A non-finite value degrades to an em-dash.
 */
export function formatInteger(value: number, lang: Lang): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return new Intl.NumberFormat(bcp47For(lang), {
    maximumFractionDigits: 0
  }).format(value)
}
