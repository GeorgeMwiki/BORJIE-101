import { bcp47For } from '@/lib/locale'
import type { LanguageCode } from '@/types/auth'

/**
 * Tanzania is the launch jurisdiction; buyer-surface amounts are
 * TZS-denominated by schema (columns named `*Tzs` / `*TzsPerKg`) so the
 * code defaults to this launch-primary value when a caller has no
 * tenant-currency field to thread. A KE/UG/NG parcel that carries its own
 * ISO code passes it as `currencyCode` and renders its own currency with
 * zero change here.
 */
export const LAUNCH_CURRENCY = 'TZS'

/**
 * Compact money render for the buyer surface — e.g. `TZS 1.20B` / `KES
 * 450.00M`. The ISO-4217 code is DATA supplied via `currencyCode`
 * (defaulting to the launch currency), never a hardcoded `'TZS '` prefix,
 * so this obeys the multi-currency canon (CLAUDE.md "Multi-currency, TZS
 * at launch · expandable"). Sub-thousand amounts render whole units.
 */
export function formatTzs(
  amount: number,
  currencyCode: string = LAUNCH_CURRENCY,
): string {
  const code = currencyCode.trim().toUpperCase() || LAUNCH_CURRENCY
  if (!Number.isFinite(amount)) {
    return `${code} —`
  }
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000_000) {
    return `${code} ${sign}${(abs / 1_000_000_000).toFixed(2)}B`
  }
  if (abs >= 1_000_000) {
    return `${code} ${sign}${(abs / 1_000_000).toFixed(2)}M`
  }
  if (abs >= 1_000) {
    return `${code} ${sign}${(abs / 1_000).toFixed(1)}K`
  }
  return `${code} ${sign}${abs.toFixed(0)}`
}

export function formatKg(kg: number): string {
  if (kg < 1) {
    return `${(kg * 1000).toFixed(0)} g`
  }
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)} t`
  }
  return `${kg.toFixed(kg < 10 ? 2 : 0)} kg`
}

export function formatDate(iso: string, lang: LanguageCode): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) {
    return '—'
  }
  return new Intl.DateTimeFormat(bcp47For(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts))
}
