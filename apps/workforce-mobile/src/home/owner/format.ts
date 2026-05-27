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
