/**
 * Generalised normaliseTo() tests — proves the FX bridge works for
 * any-target-currency, not just USD. Uses a stub loadAll so we can
 * pin the rate map deterministically.
 *
 * The math: TZS 100,000,000 minor (= 1,000,000 TZS major) at rate
 * 0.000395 USD per TZS = 395 USD. Convert that to KES at rate 0.0077
 * USD per KES → 395 / 0.0077 ≈ 51,298.70 KES.
 *
 * Borjie is built for the world (starting with TZ); this test
 * proves the same code works for an operator who picked any
 * supported currency.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCurrencyRatesService } from './currency-rates.service.js';

function fakeDbWithRates(rates: ReadonlyArray<[string, number]>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(async () => rates.map(([code, rateToUsd]) => ({ code, rateToUsd }))),
    })),
  };
}

describe('CurrencyRatesService.normaliseTo (universal target)', () => {
  it('TZS minor → USD matches the legacy normaliseToUsd math', async () => {
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const usd = await svc.normaliseTo('USD', [
      { currency: 'TZS', amountMinor: 100_000_000 },
    ]);
    // 1,000,000 TZS major × 0.000395 = 395 USD
    expect(usd).toBeCloseTo(395, 5);
  });

  it('TZS minor → KES (cross via USD)', async () => {
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
      ['KES', 0.0077],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const kes = await svc.normaliseTo('KES', [
      { currency: 'TZS', amountMinor: 100_000_000 }, // = 1,000,000 TZS major
    ]);
    // 1,000,000 TZS × 0.000395 = 395 USD; ÷ 0.0077 = ~51,298.70 KES
    expect(kes).toBeCloseTo(51298.7012987, 3);
  });

  it('mixed currencies all roll up into the target', async () => {
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
      ['KES', 0.0077],
      ['EUR', 1.08],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const eur = await svc.normaliseTo('EUR', [
      { currency: 'USD', amountMinor: 100_00 },          // 100 USD
      { currency: 'TZS', amountMinor: 100_000_000 },     // 395 USD
      { currency: 'KES', amountMinor: 100_000 },         // 1,000 KES = 7.7 USD
    ]);
    // (100 + 395 + 7.7) USD = 502.7 USD; ÷ 1.08 EUR/USD = ~465.46 EUR
    expect(eur).toBeCloseTo(502.7 / 1.08, 3);
  });

  it('unknown target falls back to USD with a warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const result = await svc.normaliseTo('XXX', [
      { currency: 'TZS', amountMinor: 100_000_000 },
    ]);
    expect(result).toBeCloseTo(395, 5); // = USD equivalent
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unknown source currency contributes 0 in target', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const tzs = await svc.normaliseTo('TZS', [
      { currency: 'XYZ', amountMinor: 100_00 },          // unknown — 0
      { currency: 'USD', amountMinor: 100_00 },          // 100 USD = 100/0.000395 TZS
    ]);
    expect(tzs).toBeCloseTo(100 / 0.000395, 3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('empty sums returns 0', async () => {
    const db = fakeDbWithRates([['USD', 1.0]]);
    const svc = createCurrencyRatesService(db as any);
    expect(await svc.normaliseTo('TZS', [])).toBe(0);
  });

  it('case-insensitive target', async () => {
    const db = fakeDbWithRates([
      ['USD', 1.0],
      ['TZS', 0.000395],
    ]);
    const svc = createCurrencyRatesService(db as any);
    const upper = await svc.normaliseTo('TZS', [{ currency: 'usd', amountMinor: 100_00 }]);
    const lower = await svc.normaliseTo('tzs', [{ currency: 'USD', amountMinor: 100_00 }]);
    expect(upper).toBeCloseTo(lower, 5);
  });
});
