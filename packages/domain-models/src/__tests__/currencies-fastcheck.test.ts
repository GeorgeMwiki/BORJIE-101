/**
 * Property-based tests for the ISO-4217 currency table — LITFIN parity
 * audit gap #9. Pure-data invariants only; no network or DB.
 *
 * Why this matters: Wave 19 fixed silent /100 division for 0-decimal
 * currencies (TZS/UGX/RWF). A reverse regression — adding an entry with
 * the wrong decimal — would silently mis-render every invoice in that
 * currency. These properties pin the table's shape so any future edit
 * either passes or fails loudly.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ISO_4217_DECIMALS,
  ISO_4217_REGEX,
  SUPPORTED_CURRENCY_CODES,
  decimalsForCurrency,
  isKnownCurrency,
} from '../common/currencies.js';

describe('ISO-4217 currency table — property invariants (fast-check, LITFIN parity #9)', () => {
  const arbKnownCode = fc.constantFrom(...SUPPORTED_CURRENCY_CODES);

  it('every code matches the 3-upper-case regex', () => {
    fc.assert(
      fc.property(arbKnownCode, (code) => ISO_4217_REGEX.test(code)),
      { numRuns: 100 },
    );
  });

  it('decimals is always 0, 2, 3, or 4', () => {
    fc.assert(
      fc.property(arbKnownCode, (code) => {
        const d = ISO_4217_DECIMALS[code];
        return d === 0 || d === 2 || d === 3 || d === 4;
      }),
      { numRuns: 100 },
    );
  });

  it('isKnownCurrency agrees with table membership', () => {
    fc.assert(
      fc.property(arbKnownCode, (code) => isKnownCurrency(code) === true),
      { numRuns: 100 },
    );
  });

  it('decimalsForCurrency returns the table value for known codes', () => {
    fc.assert(
      fc.property(arbKnownCode, (code) => {
        return decimalsForCurrency(code) === ISO_4217_DECIMALS[code];
      }),
      { numRuns: 100 },
    );
  });

  it('decimalsForCurrency defaults to 2 for unknown ISO-4217-shaped codes', () => {
    // Generate 3-letter codes that are NOT in the table.
    const arbUnknownCode = fc
      .stringMatching(/^[A-Z]{3}$/)
      .filter((c) => !isKnownCurrency(c));
    fc.assert(
      fc.property(arbUnknownCode, (code) => decimalsForCurrency(code) === 2),
      { numRuns: 50 },
    );
  });

  it('SUPPORTED_CURRENCY_CODES contains all canonical East-Africa + reserve codes', () => {
    // Spot-check guards: regression would catch table truncation.
    const mustExist = ['KES', 'TZS', 'UGX', 'RWF', 'USD', 'EUR', 'GBP', 'JPY', 'INR', 'CNY', 'NGN', 'ZAR'];
    for (const c of mustExist) {
      expect(SUPPORTED_CURRENCY_CODES).toContain(c);
    }
  });

  it('the 0-decimal subset includes every documented JPY-class currency', () => {
    const zeroDecimal = ['JPY', 'KRW', 'TZS', 'UGX', 'RWF', 'BIF', 'CLP', 'DJF', 'GNF', 'KMF', 'PYG', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'ISK', 'MGA' /* MGA is special: 0 in some sources, 2 in others */];
    for (const c of zeroDecimal) {
      if (c === 'MGA') continue; // see comment above
      expect(ISO_4217_DECIMALS[c]).toBe(0);
    }
  });
});
