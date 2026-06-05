/**
 * Worker payslip — pure view-model helpers (WS-3 workforce wires).
 *
 * The workforce-mobile vitest config runs in node with no JSX runtime, so all
 * non-JSX logic lives here and is unit-tested cold; the `.tsx` screen only
 * renders the rows this module produces. Mirrors the worker-hero-card split.
 *
 * Money rule (CLAUDE.md): NEVER hard-code a currency symbol — money rows carry
 * the raw amount + the response's `currencyCode`, and the renderer formats via
 * `formatCurrency(amount, currencyCode)`. Hours rows render plainly.
 */

import { formatCurrency } from '../home/owner/format'

export type Lang = 'sw' | 'en'

/** Bilingual field label as returned by the payroll calculator. */
export interface PayslipFieldLabel {
  readonly key:
    | 'hoursWorked'
    | 'overtimeHours'
    | 'baseTzs'
    | 'overtimeTzs'
    | 'bonusTzs'
    | 'deductionTzs'
    | 'netTzs'
  readonly kind: 'hours' | 'money'
  readonly sw: string
  readonly en: string
}

export interface PayslipLineItem {
  readonly hoursWorked: number
  readonly overtimeHours: number
  readonly hourlyRateTzs: number
  readonly baseTzs: number
  readonly overtimeTzs: number
  readonly bonusTzs: number
  readonly deductionTzs: number
  readonly netTzs: number
  readonly status: string
}

export interface PayslipData {
  readonly period: { readonly start: string; readonly end: string }
  readonly runStatus: string
  readonly lineItem: PayslipLineItem
  readonly currencyCode: string
  readonly labels: ReadonlyArray<PayslipFieldLabel>
  readonly netLabel: { readonly sw: string; readonly en: string }
}

/** Envelope shape returned by GET /api/v1/mining/payslip/me. */
export interface PayslipEnvelope {
  readonly success: boolean
  readonly data: PayslipData | null
}

/** A renderable breakdown row (one per labelled field except net). */
export interface PayslipRow {
  readonly key: string
  readonly label: string
  readonly value: string
}

/** Format an hours figure for display (trims trailing .0). */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) {
    return '—'
  }
  const rounded = Math.round(hours * 100) / 100
  return Number.isInteger(rounded) ? `${rounded} h` : `${rounded.toFixed(2)} h`
}

/**
 * Resolve a single field's display value: hours via `formatHours`, money via
 * `formatCurrency(amount, currencyCode)` (so the currency is never hard-coded).
 */
export function renderFieldValue(
  field: PayslipFieldLabel,
  lineItem: PayslipLineItem,
  currencyCode: string,
): string {
  const raw = lineItem[field.key]
  return field.kind === 'hours'
    ? formatHours(raw)
    : formatCurrency(raw, currencyCode)
}

/**
 * Build the breakdown rows for the given language. Excludes `netTzs` — the net
 * is surfaced separately as the hero card via `buildNet`.
 */
export function buildPayslipRows(data: PayslipData, lang: Lang): PayslipRow[] {
  return data.labels
    .filter((l) => l.key !== 'netTzs')
    .map((l) => ({
      key: l.key,
      label: lang === 'sw' ? l.sw : l.en,
      value: renderFieldValue(l, data.lineItem, data.currencyCode),
    }))
}

/** Build the net (you-will-receive) hero values for the given language. */
export function buildNet(
  data: PayslipData,
  lang: Lang,
): { readonly label: string; readonly value: string } {
  const netLabelDef = data.labels.find((l) => l.key === 'netTzs')
  const label = netLabelDef
    ? lang === 'sw'
      ? netLabelDef.sw
      : netLabelDef.en
    : lang === 'sw'
      ? 'Jumla utakayopokea'
      : 'You will receive'
  return {
    label,
    value: formatCurrency(data.lineItem.netTzs, data.currencyCode),
  }
}

/** Period label, e.g. "2026-05-01 → 2026-05-15". */
export function formatPeriod(data: PayslipData): string {
  return `${data.period.start} → ${data.period.end}`
}
