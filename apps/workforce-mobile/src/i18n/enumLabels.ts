/**
 * enumLabels — single source of truth for turning a bounded backend enum
 * token (severity / kind / status / phase) into a SINGLE-LOCALE label.
 *
 * The canon (CLAUDE.md · language-engineering): a raw DB enum token rendered
 * under `sw` IS language mixing. Every enum render flows through one of these
 * resolvers so the active-locale string from the i18n catalog always wins —
 * never the wire token. `t` is the active-locale dictionary (from
 * `useI18n().t` / `pickStrings(lang)`), so a single dictionary lookup yields
 * the canonical Swahili / English term with complete en/sw parity.
 *
 * Open-string kinds (opportunity / risk `kind` arrive as free strings off the
 * gateway) resolve through the known-set map first, then fall back to a
 * humanized token (snake_case → Title Case) — NEVER the raw snake_case enum.
 *
 * Pure functions, no React/RN imports, so the node vitest harness can exercise
 * them cold.
 */
import type { StringDict } from './index'

/**
 * Humanize an unknown snake_case token into a readable label so an enum value
 * the catalog has not seen yet never renders as a raw `cost_saving` wire token.
 * Locale-neutral (a proper noun / Title Case form) — used only as a last-resort
 * fallback after the localized map misses.
 */
function humanizeToken(token: string): string {
  const cleaned = token.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) {
    return ''
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** Look up a key in a localized map, falling back to a humanized token. */
function fromMap(
  map: Readonly<Record<string, string>>,
  token: string | null | undefined
): string {
  const key = (token ?? '').trim()
  return map[key] ?? humanizeToken(key)
}

/** Decision / risk severity tier → localized label. */
export function severityLabel(severity: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.severity, severity)
}

/** Opportunity kind (open string off the gateway) → localized label. */
export function opportunityKindLabel(kind: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.opportunityKind, kind)
}

/** Risk kind (open string off the gateway) → localized label. */
export function riskKindLabel(kind: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.riskKind, kind)
}

/** mining_tasks.status → localized label. */
export function taskStatusLabel(status: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.taskStatus, status)
}

/** training assignment status → localized label. */
export function trainingStatusLabel(status: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.trainingStatus, status)
}

/** document_status (signable/official docs) → localized label. */
export function documentStatusLabel(status: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.documentStatus, status)
}

/** inspection-narrative status → localized label. */
export function narrativeStatusLabel(status: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.narrativeStatus, status)
}

/** site lifecycle phase → localized label. */
export function sitePhaseLabel(phase: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.sitePhase, phase)
}

/** composer @-mention entity kind → localized label. */
export function entityKindLabel(kind: string | null | undefined, t: StringDict): string {
  return fromMap(t.enums.entityKind, kind)
}

/** Localized "Status" / "Hali" prefix for inline status rows. */
export function statusPrefix(t: StringDict): string {
  return t.enums.statusPrefix
}
