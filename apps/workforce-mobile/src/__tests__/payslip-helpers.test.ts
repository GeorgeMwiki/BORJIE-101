/**
 * Worker payslip helper tests (WS-3). Pure node, no JSX — the .tsx screen is
 * covered by the Expo E2E pack. Proves the API→view-model transform binds the
 * REAL line item, is bilingual, and renders money via formatCurrency (never a
 * hard-coded currency symbol).
 */

import { describe, expect, it } from 'vitest'

import {
  buildNet,
  buildPayslipRows,
  formatHours,
  formatPeriod,
  renderFieldValue,
  type PayslipData,
  type PayslipFieldLabel,
} from '../payslip/payslip.helpers'

const LABELS: ReadonlyArray<PayslipFieldLabel> = [
  { key: 'hoursWorked', kind: 'hours', sw: 'Masaa ya kazi', en: 'Hours worked' },
  { key: 'overtimeHours', kind: 'hours', sw: 'Masaa ya ziada', en: 'Overtime hours' },
  { key: 'baseTzs', kind: 'money', sw: 'Mshahara wa msingi', en: 'Base' },
  { key: 'overtimeTzs', kind: 'money', sw: 'Mshahara wa ziada', en: 'Overtime' },
  { key: 'bonusTzs', kind: 'money', sw: 'Bonasi', en: 'Bonus' },
  { key: 'deductionTzs', kind: 'money', sw: 'Makato', en: 'Deduction' },
  { key: 'netTzs', kind: 'money', sw: 'Jumla utakayopokea', en: 'You will receive' },
]

const DATA: PayslipData = {
  period: { start: '2026-05-01', end: '2026-05-15' },
  runStatus: 'committed',
  lineItem: {
    hoursWorked: 80,
    overtimeHours: 4,
    hourlyRateTzs: 5000,
    baseTzs: 400000,
    overtimeTzs: 30000,
    bonusTzs: 50000,
    deductionTzs: 20000,
    netTzs: 460000,
    status: 'posted',
  },
  currencyCode: 'TZS',
  labels: LABELS,
  netLabel: { sw: 'Mshahara wako: 460000.00', en: 'Your payslip: 460000.00' },
}

describe('formatHours', () => {
  it('renders whole + fractional hours, and dashes non-finite', () => {
    expect(formatHours(80)).toBe('80 h')
    expect(formatHours(4.5)).toBe('4.50 h')
    expect(formatHours(Number.NaN)).toBe('—')
  })
})

describe('renderFieldValue', () => {
  it('formats hours plainly and money via formatCurrency (currency from response)', () => {
    const hours = LABELS.find((l) => l.key === 'hoursWorked')!
    const base = LABELS.find((l) => l.key === 'baseTzs')!
    expect(renderFieldValue(hours, DATA.lineItem, DATA.currencyCode)).toBe('80 h')
    // 400000 -> "400.0k TZS" via the shared formatter; carries the code, no hard-code.
    const money = renderFieldValue(base, DATA.lineItem, DATA.currencyCode)
    expect(money).toContain('TZS')
    expect(money).toMatch(/400/)
  })

  it('honours a non-TZS currency code (multi-currency rule)', () => {
    const base = LABELS.find((l) => l.key === 'baseTzs')!
    expect(renderFieldValue(base, DATA.lineItem, 'KES')).toContain('KES')
  })
})

describe('buildPayslipRows', () => {
  it('produces one row per non-net field with bilingual labels', () => {
    const sw = buildPayslipRows(DATA, 'sw')
    const en = buildPayslipRows(DATA, 'en')
    // 6 fields excluding netTzs.
    expect(sw).toHaveLength(6)
    expect(en).toHaveLength(6)
    expect(sw.find((r) => r.key === 'hoursWorked')?.label).toBe('Masaa ya kazi')
    expect(en.find((r) => r.key === 'hoursWorked')?.label).toBe('Hours worked')
    // Real values, not the "— TZS" placeholder the old mock screen showed.
    expect(en.find((r) => r.key === 'baseTzs')?.value).toMatch(/TZS/)
    expect(en.every((r) => !r.value.startsWith('—'))).toBe(true)
  })

  it('excludes the net field from the breakdown rows', () => {
    expect(buildPayslipRows(DATA, 'en').some((r) => r.key === 'netTzs')).toBe(false)
  })
})

describe('buildNet', () => {
  it('returns the bilingual net label + the formatted net amount', () => {
    expect(buildNet(DATA, 'sw').label).toBe('Jumla utakayopokea')
    expect(buildNet(DATA, 'en').label).toBe('You will receive')
    expect(buildNet(DATA, 'en').value).toContain('TZS')
    expect(buildNet(DATA, 'en').value).toMatch(/460/)
  })
})

describe('formatPeriod', () => {
  it('renders the inclusive period', () => {
    expect(formatPeriod(DATA)).toBe('2026-05-01 → 2026-05-15')
  })
})
