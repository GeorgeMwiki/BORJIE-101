/**
 * walletFormat — multi-currency wallet display tests.
 * Per Borjie hard rule: never hard-code currency literals; the
 * formatter MUST emit a currency code prefix that matches the supplied
 * `currency` arg.
 */
import { describe, expect, it } from 'vitest'
import { formatWalletAmount } from '../marketplace/walletFormat'

describe('formatWalletAmount — multi-currency display', () => {
  it('prefixes TZS values with "TZS"', () => {
    expect(formatWalletAmount(1_500_000, 'TZS')).toBe('TZS 1.50M')
    expect(formatWalletAmount(2_000_000_000, 'TZS')).toBe('TZS 2.00B')
    expect(formatWalletAmount(2_500, 'TZS')).toBe('TZS 2.5K')
    expect(formatWalletAmount(450, 'TZS')).toBe('TZS 450')
  })

  it('prefixes USD values with "USD"', () => {
    expect(formatWalletAmount(1_234, 'USD')).toBe('USD 1.2K')
    expect(formatWalletAmount(50_000, 'USD')).toBe('USD 50.0K')
  })

  it('prefixes KES values with "KSh"', () => {
    expect(formatWalletAmount(2_500, 'KES')).toBe('KSh 2.5K')
  })

  it('treats non-finite amounts as zero', () => {
    expect(formatWalletAmount(Number.NaN, 'TZS')).toBe('TZS 0')
    expect(formatWalletAmount(Number.POSITIVE_INFINITY, 'USD')).toBe('USD 0')
  })

  it('handles zero gracefully', () => {
    expect(formatWalletAmount(0, 'TZS')).toBe('TZS 0')
  })
})
