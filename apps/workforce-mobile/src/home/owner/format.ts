import type { PillarStatus, Severity } from './types'

/**
 * Pure formatters used across owner-home sub-components. Kept side-effect-
 * free so they can be unit-tested without React or react-native imports.
 *
 * Multi-currency rule (CLAUDE.md): never hard-code TZS / USD / KES inside
 * components — callers pass an explicit `currencyCode`. The default is TZS
 * because owner-home figures originate from the TZS-primary cockpit, and
 * the API rejects non-TZS domestic contracts post-27-Mar-2026 cliff.
 */
export function formatCurrency(amount: number, currencyCode: string = 'TZS'): string {
  if (!Number.isFinite(amount)) {
    return `— ${currencyCode}`
  }
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1)}B ${currencyCode}`
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M ${currencyCode}`
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}k ${currencyCode}`
  }
  return `${sign}${abs.toFixed(0)} ${currencyCode}`
}

/**
 * Resolve the Intl BCP-47 tag from the active app locale — the
 * locale-follows-the-user canon (CLAUDE.md "English default · bilingual
 * sw/en"). NEVER hardcode `'en-TZ'`/`'en-GB'` in a component and NEVER let
 * a bare `.toLocaleString()` fall through to the host device locale, which
 * would render one screen in a language the user never chose. This mirrors
 * the owner-web `bcp47For` single-resolver pattern.
 */
const BCP47_BY_LANG: Readonly<Record<'sw' | 'en', string>> = {
  sw: 'sw-TZ',
  en: 'en-GB'
}

export function bcp47For(lang: 'sw' | 'en'): string {
  // Map lookup (not a locale ternary): these are Intl BCP-47 TAGS, not
  // user-facing copy, and English is the structural default for any
  // unexpected value.
  return BCP47_BY_LANG[lang] ?? BCP47_BY_LANG.en
}

/**
 * Locale-aware date+time render for the active app locale. Replaces bare
 * `new Date(iso).toLocaleString()` calls that silently pick up the host
 * device locale (a zero-mix violation — one surface can drift to another
 * language). A non-parseable ISO string degrades to an em-dash rather than
 * painting `Invalid Date`.
 */
export function formatDateTime(iso: string, lang: 'sw' | 'en'): string {
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
 * `n.toLocaleString()` calls that fall through to the host locale's digit
 * grouping. A non-finite value degrades to an em-dash.
 */
export function formatInteger(value: number, lang: 'sw' | 'en'): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return new Intl.NumberFormat(bcp47For(lang), {
    maximumFractionDigits: 0
  }).format(value)
}

export function formatTonnes(tonnes: number): string {
  if (!Number.isFinite(tonnes)) {
    return '— t'
  }
  if (tonnes >= 1_000) {
    return `${(tonnes / 1_000).toFixed(1)}kt`
  }
  return `${tonnes.toFixed(0)} t`
}

export function formatDelta(pct: number): string {
  if (!Number.isFinite(pct)) {
    return '—'
  }
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

export function formatRecomputeMinutes(generatedAtIso: string, now: number = Date.now()): number {
  const ts = Date.parse(generatedAtIso)
  if (!Number.isFinite(ts)) {
    return Number.NaN
  }
  const diffMs = now - ts
  if (diffMs < 0) {
    return 0
  }
  return Math.floor(diffMs / 60_000)
}

/**
 * Pure: classify a delta-pct against target into a pillar status. Symmetric
 * around zero so the same threshold reads "warn" whether we're +5 or -5%.
 * For mining-specific risk asymmetry (safety incidents) callers pre-classify.
 */
export function classifyDelta(deltaPct: number): PillarStatus {
  if (!Number.isFinite(deltaPct)) {
    return 'warn'
  }
  const abs = Math.abs(deltaPct)
  if (abs >= 20) {
    return 'danger'
  }
  if (abs >= 5) {
    return 'warn'
  }
  return 'ok'
}

/**
 * Pure: rank severities for a stable sort (high → amber → info). Used by
 * the AlertQueue before the spec-mandated cap to MAX_DECISIONS.
 */
export function severityRank(severity: Severity): number {
  if (severity === 'high') {
    return 0
  }
  if (severity === 'amber') {
    return 1
  }
  return 2
}
