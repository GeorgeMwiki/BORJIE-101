/**
 * Unit tests for `formatGroundingValue` — the kernel's fact-formatter.
 *
 * The legacy formatter only handled `currency-tzs` and `currency-kes`
 * cases and silently fell through to `String(value)` for anything else.
 * ProdFix-2 wire #5 widened it to any ISO-4217 currency code via
 * `Intl.NumberFormat`; these tests pin the new behaviour.
 */

import { describe, expect, it } from 'vitest';

import { formatGroundingValue } from '../kernel.js';
import type { GroundingFact } from '../kernel-types.js';

function fact(
  unit: GroundingFact['unit'],
  value: number,
): GroundingFact {
  return {
    id: 'f',
    label: 'l',
    value,
    unit,
    source: 'test',
    asOf: '2026-05-18T00:00:00Z',
  };
}

describe('formatGroundingValue', () => {
  it('formats currency-tzs the legacy way (still works)', () => {
    expect(formatGroundingValue(fact('currency-tzs', 1500))).toMatch(/TZS/);
    expect(formatGroundingValue(fact('currency-tzs', 1500))).toContain('1,500');
  });

  it('formats currency-kes the legacy way (still works)', () => {
    expect(formatGroundingValue(fact('currency-kes', 2500))).toMatch(/KES/);
  });

  it('formats currency-eur — a code outside the legacy switch', () => {
    const out = formatGroundingValue(fact('currency-eur', 1234));
    expect(out).toContain('EUR');
    expect(out).toContain('1,234');
  });

  it('formats currency-zar — another code outside the legacy switch', () => {
    const out = formatGroundingValue(fact('currency-zar', 9999));
    expect(out).toContain('ZAR');
    expect(out).toContain('9,999');
  });

  it('formats currency-jpy (zero-decimal) without crashing', () => {
    const out = formatGroundingValue(fact('currency-jpy', 100_000));
    expect(out).toContain('JPY');
  });

  it('falls back to "<code> <number>" for an unknown ISO-4217 code', () => {
    // Intl.NumberFormat throws on truly unknown codes; the formatter
    // must surface the value rather than dropping it.
    const out = formatGroundingValue(fact('currency-aaa' as never, 42));
    expect(out).toContain('AAA');
    expect(out).toContain('42');
  });

  it('still formats pct, count, days correctly', () => {
    expect(formatGroundingValue(fact('pct', 0.25))).toBe('25.0%');
    expect(formatGroundingValue(fact('count', 7))).toBe('7');
    expect(formatGroundingValue(fact('days', 3.2))).toBe('3.2 days');
  });

  it('passes through string values unchanged', () => {
    expect(
      formatGroundingValue({
        id: 'f',
        label: 'l',
        value: 'hello',
        source: 'test',
        asOf: '2026-05-18T00:00:00Z',
      }),
    ).toBe('hello');
  });
});
